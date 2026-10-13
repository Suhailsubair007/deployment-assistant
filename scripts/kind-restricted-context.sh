#!/usr/bin/env bash
# Adds a kubeconfig context that can do only what the assistant is allowed to do.
# Use it to check, on the local cluster, that the assistant's permissions are enough
# and no more:
#
#   ./scripts/kind-restricted-context.sh
#   KUBE_CONTEXT=kind-deploy-assistant-restricted npm start
set -euo pipefail

ADMIN_CONTEXT="kind-deploy-assistant"
RESTRICTED_CONTEXT="kind-deploy-assistant-restricted"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

kubectl --context "${ADMIN_CONTEXT}" apply -f "${ROOT}/k8s/local/assistant-rbac.yaml"

# A login token for the ServiceAccount, valid for 8 hours.
TOKEN="$(kubectl --context "${ADMIN_CONTEXT}" -n default create token deployment-assistant --duration=8h)"
kubectl config set-credentials "${RESTRICTED_CONTEXT}" --token="${TOKEN}" >/dev/null
kubectl config set-context "${RESTRICTED_CONTEXT}" --cluster="${ADMIN_CONTEXT}" --user="${RESTRICTED_CONTEXT}" >/dev/null

echo
echo "Context ${RESTRICTED_CONTEXT} is ready (token valid for 8 hours)."
echo "Start the assistant with it:  KUBE_CONTEXT=${RESTRICTED_CONTEXT} npm start"
