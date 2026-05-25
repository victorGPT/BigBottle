# BigBottle AWS Supabase Self-Hosted Deployment

This directory is an operations overlay for running BigBottle on a self-hosted Supabase stack on AWS.

Use the official Supabase Docker Compose stack as the base. Do not vendor the upstream compose file into this repo; pull it on the EC2 host so upgrades stay explicit.

## EC2 Host Layout

Recommended paths:

```text
/opt/bigbottle-supabase/
  docker-compose.yml
  .env
  volumes/
    db/
    functions/
      api/
        index.ts
    storage/
```

## Bootstrap Outline

On the EC2 host:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"

sudo mkdir -p /opt/bigbottle-supabase
sudo chown "$USER":"$USER" /opt/bigbottle-supabase

git clone --depth 1 https://github.com/supabase/supabase /tmp/supabase
cp -R /tmp/supabase/docker/* /opt/bigbottle-supabase/
cd /opt/bigbottle-supabase
cp .env.example .env
```

Edit `/opt/bigbottle-supabase/.env` with fresh self-hosted Supabase secrets. Then start:

```bash
docker compose pull
docker compose up -d
```

## Deploy BigBottle Function

From the repo checkout on your local machine:

```bash
scripts/ci/package_self_hosted_supabase_api.sh
```

Copy the generated bundle to the EC2 host:

```bash
scp .tmp/bigbottle-self-hosted-supabase-api.tgz ubuntu@<host>:/tmp/
ssh ubuntu@<host> 'cd /opt/bigbottle-supabase && tar -xzf /tmp/bigbottle-self-hosted-supabase-api.tgz'
```

Configure function env vars using `deploy/aws-supabase/functions.env.example` as the checklist. In the official self-hosted compose, make those variables available to the `functions` service via `env_file` or `environment`.

Restart functions:

```bash
docker compose up -d --force-recreate --no-deps functions
```

## Smoke Tests

```bash
curl -fsS https://<domain>/functions/v1/api/health
curl -fsS -X POST https://<domain>/functions/v1/api/auth/challenge \
  -H 'content-type: application/json' \
  --data '{"address":"0x0000000000000000000000000000000000000001"}'
```

Then run the same receipt upload smoke used for hosted Supabase, with `baseUrl` changed to the AWS domain.

## Notes

- Keep Postgres private. The browser and public clients should only reach Kong/HTTPS.
- Use fresh `JWT_SECRET`, `ANON_KEY`, and `SERVICE_ROLE_KEY`; do not reuse hosted Supabase keys unless there is a deliberate compatibility reason.
- `BB_SUPABASE_URL` should point to the self-hosted public API gateway, for example `https://<domain>`.
- `BB_SUPABASE_SERVICE_ROLE_KEY` must match the self-hosted `SERVICE_ROLE_KEY`.
