#!/usr/bin/env bash
# Checks the Terraform code without touching AWS: formatting, validity and lint.
# Run it before every commit; the GitHub workflow runs the same script.
set -euo pipefail

TFLINT_VERSION="v0.64.0"
TERRAFORM_DIR="$(cd "$(dirname "$0")/../terraform" && pwd)"
cd "${TERRAFORM_DIR}"

echo "==> terraform fmt"
terraform fmt -check -recursive

# The three stacks: the state bucket, the cluster, and the per-service image repository.
# "validate" needs the providers and modules of a stack, but not its state.
for stack in bootstrap . service; do
  echo "==> terraform validate (${stack})"
  if [ -f "${stack}/.terraform/terraform.tfstate" ]; then
    # A real "terraform init" has already connected this folder to the state bucket,
    # so its providers and modules are in place. init is left out here on purpose:
    # in a connected folder even "init -backend=false" reads the state from S3.
    echo "    already connected to a state bucket: init skipped, so nothing is read from S3"
  else
    # -backend=false downloads the providers and modules and leaves S3 alone.
    terraform -chdir="${stack}" init -backend=false -input=false >/dev/null
  fi
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
