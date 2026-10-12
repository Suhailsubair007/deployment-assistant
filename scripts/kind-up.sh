#!/usr/bin/env bash
# Creates the local test cluster and everything the assistant expects to find in it:
# the sample-app images, the staging and prod namespaces, and metrics-server.
# Safe to run again: steps that are already done are skipped.
set -euo pipefail

CLUSTER="deploy-assistant"
CONTEXT="kind-${CLUSTER}"
METRICS_SERVER_VERSION="v0.9.0"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Cluster"
if kind get clusters 2>/dev/null | grep -qx "${CLUSTER}"; then
  echo "kind cluster ${CLUSTER} already exists"
else
  kind create cluster --name "${CLUSTER}" --wait 120s
fi

echo "==> Sample app images (v1, v2 and the broken v3)"
docker build --quiet --build-arg APP_VERSION=v1 -t sample-app:v1 "${ROOT}/sample-app"
docker build --quiet --build-arg APP_VERSION=v2 -t sample-app:v2 "${ROOT}/sample-app"
docker build --quiet --build-arg APP_VERSION=v3 --build-arg CRASH_ON_START=true -t sample-app:v3 "${ROOT}/sample-app"
# kind cannot pull from your laptop's Docker, so the images are copied into the cluster node.
kind load docker-image sample-app:v1 sample-app:v2 sample-app:v3 --name "${CLUSTER}"

echo "==> Namespaces"
kubectl --context "${CONTEXT}" apply -f "${ROOT}/k8s/local/namespaces.yaml"

echo "==> metrics-server ${METRICS_SERVER_VERSION}"
if kubectl --context "${CONTEXT}" -n kube-system get deployment metrics-server \
  -o jsonpath='{.spec.template.spec.containers[0].args}' 2>/dev/null | grep -q -- "--kubelet-insecure-tls"; then
  echo "metrics-server is already installed"
else
  kubectl --context "${CONTEXT}" apply -f \
    "https://github.com/kubernetes-sigs/metrics-server/releases/download/${METRICS_SERVER_VERSION}/components.yaml"
  # kind nodes use self-signed certificates, so metrics-server must skip that check here.
  # (Not needed on EKS, where it is installed as an add-on.)
  kubectl --context "${CONTEXT}" -n kube-system patch deployment metrics-server --type=json \
    -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
fi
kubectl --context "${CONTEXT}" -n kube-system rollout status deployment/metrics-server --timeout=180s

echo
echo "Ready. Context: ${CONTEXT}"
echo "CPU and memory numbers appear about a minute after metrics-server starts."
