#!/usr/bin/env bash
# Deletes the local test cluster created by kind-up.sh.
set -euo pipefail

kind delete cluster --name "deploy-assistant"
