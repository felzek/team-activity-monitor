# Terraform scaffold

This folder holds the AWS-oriented production scaffold for the application.

Current state:

- `versions.tf` pins Terraform and the AWS provider
- `variables.tf` defines the environment contract for the future ECS/RDS/ElastiCache target

Why it is intentionally light right now:

- the runnable app path in this repository is optimized for local use and direct Vercel deployment
- the current hosted runtime path is the Vercel Express deployment described in the root [`README.md`](../README.md)
- this folder is a future AWS scaffold, not a live production stack yet
- the AWS variables are included now so CI/CD, secrets, and environment naming can stabilize before the database/auth runtime is migrated to managed AWS services

Recommended next increment:

1. Move the runtime persistence layer from SQLite to managed Postgres and Redis.
2. Introduce Cognito-backed auth for production mode.
3. Expand this folder into full ECS, ALB, RDS, ElastiCache, SQS, and Secrets Manager resources.
