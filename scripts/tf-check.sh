#!/usr/bin/env bash
# Checks the Terraform code without touching AWS: formatting, validity and lint.
# Run it before every commit; the GitHub workflow runs the same script.
set -euo pipefail

TFLINT_VERSION="v0.64.0"
TERRAFORM_DIR="$(cd "$(dirname "$0")/../terraform" && pwd)"
cd "${TERRAFORM_DIR}"

echo "==> terraform fmt"
terraform fmt -check -recursive

# "validate" needs the providers and modules, but not the state: -backend=false skips S3.
for stack in bootstrap .; do
  echo "==> terraform validate (${stack})"
  terraform -chdir="${stack}" init -backend=false -input=false >/dev/null
  terraform -chdir="${stack}" validate
done

echo "==> tflint ${TFLINT_VERSION}"
# One config file for every folder: with --recursive each folder would otherwise use the defaults.
if command -v tflint >/dev/null 2>&1; then
  tflint --init --config "${TERRAFORM_DIR}/.tflint.hcl" >/dev/null
  tflint --recursive --config "${TERRAFORM_DIR}/.tflint.hcl"
else
  # tflint is not installed: run the same version from its official container image.
  docker run --rm --quiet --volume "${TERRAFORM_DIR}:/data:ro" --workdir /data --entrypoint sh \
    "ghcr.io/terraform-linters/tflint:${TFLINT_VERSION}" \
    -c "tflint --init --config /data/.tflint.hcl >/dev/null && tflint --recursive --config /data/.tflint.hcl"
fi

echo
echo "Terraform checks passed."
