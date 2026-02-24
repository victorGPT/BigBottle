#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone

ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
X_LEVELS = {4, 5, 6, 7}


@dataclass
class SnapshotRow:
    snapshot_date: str
    token_id: int
    owner_address: str
    node_level: int
    is_x: bool
    source: str
    contract_address: str
    synced_at: str


def build_call_url(api_base: str, contract_address: str, signature: str) -> str:
    encoded = urllib.parse.quote(signature, safe="")
    return f"{api_base.rstrip('/')}/{contract_address.lower()}/{encoded}"


def fetch_json(url: str, max_retries: int, backoff_sec: float) -> object:
    last_error: str | None = None
    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(url, headers={"accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = resp.read().decode("utf-8")
            return json.loads(body)
        except Exception as exc:  # noqa: BLE001
            last_error = str(exc)
            time.sleep(backoff_sec * (2**attempt))
    raise RuntimeError(f"request failed after retries: {url} :: {last_error}")


def fetch_uint(api_base: str, contract_address: str, signature: str, *, max_retries: int, backoff_sec: float) -> int:
    payload = fetch_json(build_call_url(api_base, contract_address, signature), max_retries=max_retries, backoff_sec=backoff_sec)
    if isinstance(payload, str):
        return int(payload)
    raise RuntimeError(f"unexpected uint payload for {signature}: {payload!r}")


def fetch_str(api_base: str, contract_address: str, signature: str, *, max_retries: int, backoff_sec: float) -> str:
    payload = fetch_json(build_call_url(api_base, contract_address, signature), max_retries=max_retries, backoff_sec=backoff_sec)
    if isinstance(payload, str):
        return payload
    raise RuntimeError(f"unexpected string payload for {signature}: {payload!r}")


def fetch_obj(api_base: str, contract_address: str, signature: str, *, max_retries: int, backoff_sec: float) -> dict:
    payload = fetch_json(build_call_url(api_base, contract_address, signature), max_retries=max_retries, backoff_sec=backoff_sec)
    if isinstance(payload, dict):
        return payload
    raise RuntimeError(f"unexpected object payload for {signature}: {payload!r}")


def run_psql_upsert(database_url: str, csv_path: str) -> None:
    sql = f"""
create temp table _bb_vechain_node_holder_import (
  snapshot_date date not null,
  token_id bigint not null,
  owner_address text not null,
  node_level integer not null,
  is_x boolean not null,
  source text not null,
  contract_address text not null,
  synced_at timestamptz not null
);

\\copy _bb_vechain_node_holder_import (
  snapshot_date,
  token_id,
  owner_address,
  node_level,
  is_x,
  source,
  contract_address,
  synced_at
) from '{csv_path}' with (format csv, header true);

with upserted as (
  insert into public.vechain_node_holder_daily (
    snapshot_date,
    token_id,
    owner_address,
    node_level,
    is_x,
    source,
    contract_address,
    synced_at
  )
  select
    snapshot_date,
    token_id,
    owner_address,
    node_level,
    is_x,
    source,
    contract_address,
    synced_at
  from _bb_vechain_node_holder_import
  on conflict (snapshot_date, contract_address, token_id)
  do update set
    owner_address = excluded.owner_address,
    node_level = excluded.node_level,
    is_x = excluded.is_x,
    source = excluded.source,
    contract_address = excluded.contract_address,
    synced_at = excluded.synced_at,
    updated_at = now()
  returning 1
)
select count(*) as upserted_rows from upserted;
"""

    proc = subprocess.run(
        ["psql", "-X", database_url, "-v", "ON_ERROR_STOP=1", "-Atqc", sql],
        text=True,
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"psql upsert failed: {proc.stderr.strip()}")

    print(f"[db] upserted rows: {proc.stdout.strip()}")


def scan_legacy_contract(
    api_base: str,
    contract_address: str,
    snapshot_date: str,
    synced_at: str,
    delay: float,
    max_retries: int,
    backoff_sec: float,
    max_token_id: int,
) -> tuple[list[SnapshotRow], list[str], int]:
    total_supply = fetch_uint(
        api_base,
        contract_address,
        "totalSupply() returns (uint256)",
        max_retries=max_retries,
        backoff_sec=backoff_sec,
    )
    upper = total_supply if max_token_id <= 0 else min(total_supply, max_token_id)
    print(f"[legacy] totalSupply={total_supply}, scanning token_id 1..{upper}")

    rows: list[SnapshotRow] = []
    failures: list[str] = []

    for token_id in range(1, upper + 1):
        if token_id > 1:
            time.sleep(delay)

        sig = (
            f"getMetadata(uint256 {token_id}) returns "
            "(address owner, uint8 level, bool isOnUpgrade, bool isOnAuction, "
            "uint256 lastTransferTime, uint64 createdAt, uint64 updatedAt)"
        )

        try:
            meta = fetch_obj(api_base, contract_address, sig, max_retries=max_retries, backoff_sec=backoff_sec)
        except Exception as exc:  # noqa: BLE001
            failures.append(f"legacy token_id={token_id} err={exc}")
            continue

        owner = str(meta.get("owner", "")).lower()
        try:
            level = int(meta.get("level", "0"))
        except Exception:  # noqa: BLE001
            level = 0

        if not owner or owner == ZERO_ADDRESS or level <= 0:
            continue

        rows.append(
            SnapshotRow(
                snapshot_date=snapshot_date,
                token_id=token_id,
                owner_address=owner,
                node_level=level,
                is_x=level in X_LEVELS,
                source="call.api.vechain.energy/legacy",
                contract_address=contract_address.lower(),
                synced_at=synced_at,
            )
        )

        if token_id % 500 == 0:
            print(f"[legacy] progress token_id={token_id}/{upper}, valid_rows={len(rows)}")

    return rows, failures, total_supply


def scan_stargate_contract(
    api_base: str,
    contract_address: str,
    snapshot_date: str,
    synced_at: str,
    delay: float,
    max_retries: int,
    backoff_sec: float,
    max_items: int,
) -> tuple[list[SnapshotRow], list[str], int]:
    total_supply = fetch_uint(
        api_base,
        contract_address,
        "totalSupply() returns (uint256)",
        max_retries=max_retries,
        backoff_sec=backoff_sec,
    )
    upper_items = total_supply if max_items <= 0 else min(total_supply, max_items)
    print(f"[stargate] totalSupply={total_supply}, scanning index 0..{upper_items - 1}")

    rows: list[SnapshotRow] = []
    failures: list[str] = []

    for idx in range(0, upper_items):
        if idx > 0:
            time.sleep(delay)

        try:
            token_id = fetch_uint(
                api_base,
                contract_address,
                f"tokenByIndex(uint256 {idx}) returns (uint256)",
                max_retries=max_retries,
                backoff_sec=backoff_sec,
            )
            owner = fetch_str(
                api_base,
                contract_address,
                f"ownerOf(uint256 {token_id}) returns (address)",
                max_retries=max_retries,
                backoff_sec=backoff_sec,
            ).lower()
            token_obj = fetch_obj(
                api_base,
                contract_address,
                f"getToken(uint256 {token_id}) returns (uint256 tokenId, uint8 levelId, uint64 mintedAtBlock, uint248 vetAmountStaked, uint64 deprecated_lastVthoClaimedAt)",
                max_retries=max_retries,
                backoff_sec=backoff_sec,
            )
        except Exception as exc:  # noqa: BLE001
            failures.append(f"stargate index={idx} err={exc}")
            continue

        try:
            level = int(token_obj.get("levelId", token_obj.get("1", "0")))
        except Exception:  # noqa: BLE001
            level = 0

        if not owner or owner == ZERO_ADDRESS or level <= 0:
            continue

        rows.append(
            SnapshotRow(
                snapshot_date=snapshot_date,
                token_id=token_id,
                owner_address=owner,
                node_level=level,
                is_x=level in X_LEVELS,
                source="call.api.vechain.energy/stargate",
                contract_address=contract_address.lower(),
                synced_at=synced_at,
            )
        )

        if idx % 1000 == 0 and idx > 0:
            print(f"[stargate] progress index={idx}/{upper_items - 1}, valid_rows={len(rows)}")

    return rows, failures, total_supply


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync VeChain node holders daily snapshot (full-network)")
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL", ""))
    parser.add_argument("--api-base", default=os.getenv("VECHAIN_NODE_CALL_API_BASE", "https://call.api.vechain.energy/main"))
    parser.add_argument(
        "--legacy-contract-address",
        default=os.getenv("VECHAIN_NODE_LEGACY_CONTRACT_ADDRESS", "0xb81e9c5f9644dec9e5e3cac86b4461a222072302"),
    )
    parser.add_argument(
        "--stargate-nft-contract-address",
        default=os.getenv("VECHAIN_NODE_STARGATE_NFT_CONTRACT_ADDRESS", "0x1856c533ac2d94340aaa8544d35a5c1d4a21dee7"),
    )
    parser.add_argument(
        "--snapshot-date",
        default=os.getenv("SNAPSHOT_DATE", datetime.now(timezone.utc).date().isoformat()),
    )
    parser.add_argument("--rps", type=float, default=float(os.getenv("VECHAIN_NODE_SYNC_RPS", "3")))
    parser.add_argument("--max-retries", type=int, default=int(os.getenv("VECHAIN_NODE_MAX_RETRIES", "5")))
    parser.add_argument("--backoff-sec", type=float, default=0.5)
    parser.add_argument("--max-legacy-token-id", type=int, default=0)
    parser.add_argument("--max-stargate-items", type=int, default=0)
    parser.add_argument("--dry-run", action="store_true")

    args = parser.parse_args()

    if args.rps <= 0:
        raise ValueError("--rps must be > 0")

    delay = 1.0 / args.rps
    synced_at = datetime.now(timezone.utc).isoformat()

    legacy_rows, legacy_failures, legacy_supply = scan_legacy_contract(
        api_base=args.api_base,
        contract_address=args.legacy_contract_address,
        snapshot_date=args.snapshot_date,
        synced_at=synced_at,
        delay=delay,
        max_retries=args.max_retries,
        backoff_sec=args.backoff_sec,
        max_token_id=args.max_legacy_token_id,
    )

    stargate_rows, stargate_failures, stargate_supply = scan_stargate_contract(
        api_base=args.api_base,
        contract_address=args.stargate_nft_contract_address,
        snapshot_date=args.snapshot_date,
        synced_at=synced_at,
        delay=delay,
        max_retries=args.max_retries,
        backoff_sec=args.backoff_sec,
        max_items=args.max_stargate_items,
    )

    rows = legacy_rows + stargate_rows
    failures = legacy_failures + stargate_failures

    level_dist = Counter(r.node_level for r in rows)
    owner_dist = Counter(r.owner_address for r in rows)

    print(
        json.dumps(
            {
                "snapshot_date": args.snapshot_date,
                "legacy_total_supply": legacy_supply,
                "stargate_total_supply": stargate_supply,
                "valid_rows": len(rows),
                "distinct_owners": len(owner_dist),
                "legacy_rows": len(legacy_rows),
                "stargate_rows": len(stargate_rows),
                "level_distribution": dict(sorted(level_dist.items())),
                "failures": len(failures),
                "sample_failures": failures[:5],
            },
            ensure_ascii=False,
            indent=2,
        )
    )

    if args.dry_run:
        print("[sync] dry-run completed (no DB write)")
        return 0

    if not args.database_url:
        raise RuntimeError("DATABASE_URL is required for non-dry-run mode")

    if not rows:
        raise RuntimeError("no valid holder rows fetched; aborting DB upsert")

    with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False, newline="") as fp:
        writer = csv.writer(fp)
        writer.writerow(
            [
                "snapshot_date",
                "token_id",
                "owner_address",
                "node_level",
                "is_x",
                "source",
                "contract_address",
                "synced_at",
            ]
        )
        for r in rows:
            writer.writerow(
                [
                    r.snapshot_date,
                    r.token_id,
                    r.owner_address,
                    r.node_level,
                    str(r.is_x).lower(),
                    r.source,
                    r.contract_address,
                    r.synced_at,
                ]
            )
        csv_path = fp.name

    try:
        run_psql_upsert(args.database_url, csv_path)
    finally:
        try:
            os.unlink(csv_path)
        except OSError:
            pass

    print("[sync] completed successfully")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
