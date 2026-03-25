# VERIFY-H028: Health Endpoint Exposes Dependency Status
**Status:** NOT_FIXED (accepted risk)
**Round:** 3
**Date:** 2026-03-12

## Evidence
Health route was touched in phase 89-03 (internal health endpoint for Railway), but the pattern remains the same: boolean connectivity status for dependencies is returned in the response body. No version numbers or sensitive credentials exposed.

## Assessment
Accepted risk. Standard health endpoint practice for container orchestration (Railway health checks). Boolean up/down status for postgres and solanaRpc is low-sensitivity information.
