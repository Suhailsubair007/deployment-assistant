#!/usr/bin/env bash
# Builds the three sample app images for EKS and pushes them to the ECR repository
# that Terraform created.
#
#   ./scripts/push-sample-app.sh "$(terraform -chdir=terraform output -raw image_registry)"
#
# The images are built for linux/amd64, because the worker nodes are x86 machines
# (a Mac with Apple silicon would otherwise build arm64 images the nodes cannot run).
set -euo pipefail

REGISTRY="${1:?Pass the image registry, for example 111122223333.dkr.ecr.ap-south-1.amazonaws.com/deployment-assistant-staging}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 111122223333.dkr.ecr.ap-south-1.amazonaws.com/deployment-assistant-staging
#   host   = everything before the first slash
#   region = the fourth part of the host name
HOST="${REGISTRY%%/*}"
REGION="$(echo "${HOST}" | cut -d. -f4)"

# Docker gets a 12-hour password for ECR straight from the AWS CLI.
aws ecr get-login-password --region "${REGION}" | docker login --username AWS --password-stdin "${HOST}"

build_and_push() {
  local version="$1" crash="$2"
  local image="${REGISTRY}/sample-app:${version}"
  docker build --quiet --platform linux/amd64 \
    --build-arg APP_VERSION="${version}" --build-arg CRASH_ON_START="${crash}" \
    -t "${image}" "${ROOT}/sample-app"
  docker push --quiet "${image}"
  echo "pushed ${image}"
}

build_and_push v1 false
build_and_push v2 false
build_and_push v3 true # the broken version: it exits as soon as it starts

echo
echo "Start the assistant against EKS with:"
echo "  KUBE_CONTEXT=eks-assistant IMAGE_REGISTRY=${REGISTRY} npm start"
