#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { Wallet } from "ethers";

const baseUrlRaw = process.env.REWARDS_API_BASE_URL?.trim();

if (!baseUrlRaw) {
  console.error("[rewards-api-smoke] Missing REWARDS_API_BASE_URL");
  process.exit(1);
}

const baseUrl = baseUrlRaw.replace(/\/+$/, "");

function fail(message, details) {
  console.error(`[rewards-api-smoke] ${message}`);
  if (details !== undefined) {
    try {
      console.error(JSON.stringify(details, null, 2));
    } catch {
      console.error(String(details));
    }
  }
  process.exit(1);
}

async function request(path, init = {}) {
  const res = await fetch(`${baseUrl}${path}`, init);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, text, json };
}

function assertSmokeRouteExists(routeName, result) {
  if (result.status === 404) {
    fail(`${routeName} returned 404`, result);
  }
  if (result.json?.error === "not_found") {
    fail(`${routeName} returned not_found`, result);
  }
  if (result.status >= 500) {
    fail(`${routeName} returned ${result.status}`, result);
  }
  if (result.status === 401) {
    return;
  }
  console.warn(`[rewards-api-smoke] WARN ${routeName} returned ${result.status}; accepted because route exists`);
}

function assertStringB3tr(value, routeName, payload) {
  if (typeof value !== "string") {
    fail(`${routeName} contract violation: b3tr_amount must be string`, payload);
  }
}

async function run() {
  console.log(`[rewards-api-smoke] Base URL: ${baseUrl}`);

  const smokeTargets = [
    {
      name: "GET /rewards/quote",
      path: "/rewards/quote",
      init: { method: "GET" },
    },
    {
      name: "GET /rewards/claims",
      path: "/rewards/claims?limit=20",
      init: { method: "GET" },
    },
    {
      name: "POST /rewards/claim",
      path: "/rewards/claim",
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_claim_id: randomUUID() }),
      },
    },
  ];

  for (const target of smokeTargets) {
    const result = await request(target.path, target.init);
    assertSmokeRouteExists(target.name, result);
    console.log(`[rewards-api-smoke] PASS ${target.name} -> ${result.status}`);
  }

  const wallet = Wallet.createRandom();
  const challenge = await request("/auth/challenge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: wallet.address }),
  });

  if (challenge.status !== 200 || !challenge.json?.typed_data || !challenge.json?.challenge_id) {
    fail("auth challenge failed", challenge);
  }

  const typedData = challenge.json.typed_data;
  const typedDataValue = typedData.value ?? typedData.message;
  if (!typedDataValue || typeof typedDataValue !== "object") {
    fail("auth challenge missing typed_data value/message payload", challenge.json);
  }
  const signature = await wallet.signTypedData(typedData.domain, typedData.types, typedDataValue);

  const verify = await request("/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      challenge_id: challenge.json.challenge_id,
      signature,
    }),
  });

  if (verify.status !== 200 || typeof verify.json?.access_token !== "string") {
    fail("auth verify failed", verify);
  }

  const authHeaders = {
    authorization: `Bearer ${verify.json.access_token}`,
    "content-type": "application/json",
  };

  const quote = await request("/rewards/quote", {
    method: "GET",
    headers: authHeaders,
  });
  if (quote.status !== 200 || !quote.json?.quote) {
    fail("GET /rewards/quote with auth failed", quote);
  }
  assertStringB3tr(quote.json.quote.b3tr_amount, "GET /rewards/quote", quote.json);
  console.log("[rewards-api-smoke] PASS contract GET /rewards/quote quote.b3tr_amount is string");

  const claims = await request("/rewards/claims?limit=20", {
    method: "GET",
    headers: authHeaders,
  });
  if (claims.status === 404 || claims.json?.error === "not_found") {
    fail("GET /rewards/claims with auth returned not_found", claims);
  }
  if (claims.status !== 200 || !Array.isArray(claims.json?.claims)) {
    fail("GET /rewards/claims with auth failed", claims);
  }
  for (const claim of claims.json.claims) {
    assertStringB3tr(claim?.b3tr_amount, "GET /rewards/claims", claim);
  }
  console.log(`[rewards-api-smoke] PASS contract GET /rewards/claims (${claims.json.claims.length} items)`);

  const createClaim = await request("/rewards/claim", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ client_claim_id: randomUUID() }),
  });

  if (createClaim.status === 200) {
    assertStringB3tr(createClaim.json?.claim?.b3tr_amount, "POST /rewards/claim", createClaim.json);
    console.log("[rewards-api-smoke] PASS contract POST /rewards/claim claim.b3tr_amount is string");
  } else if (createClaim.status === 409 && createClaim.json?.error === "insufficient_points") {
    console.log("[rewards-api-smoke] PASS POST /rewards/claim -> insufficient_points (expected for empty account)");
  } else if (createClaim.status === 404 || createClaim.json?.error === "not_found") {
    fail("POST /rewards/claim with auth returned not_found", createClaim);
  } else {
    fail("POST /rewards/claim unexpected response", createClaim);
  }
}

run().catch((error) => {
  fail("unexpected failure", {
    name: error?.name,
    message: error?.message,
    stack: error?.stack,
  });
});
