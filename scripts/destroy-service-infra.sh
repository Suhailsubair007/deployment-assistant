#!/usr/bin/env bash
# Removes the image repository of every service the assistant created for one
# cluster, with every image in it, by destroying each service's small Terraform
# stack (terraform/service).
#
#   ./scripts/destroy-service-infra.sh <state-bucket> <region> <cluster-name>
#
#   ./scripts/destroy-service-infra.sh \
#     "$(terraform -chdir=terraform/bootstrap output -raw state_bucket)" \
#     ap-south-1 deployment-assistant-staging
#
# Run it by hand before the cluster is destroyed, and in any case before the state
# bucket is: each service has its own state file in that bucket, and once the file
# is gone Terraform no longer knows that the repository exists.
#
# It needs Terraform and the AWS CLI, logged in with rights to list, read and write
# the state bucket and to delete ECR repositories. The region is the one the state
# bucket and the cluster are in. Stop the assistant first, so that it does not run
# Terraform in the same folder at the same time.
#
# Running it twice does no harm. A destroyed service leaves an empty state file in
# the bucket, so it is listed again, and destroying it again changes nothing.
set -euo pipefail

BUCKET="${1:?Pass the state bucket, the region and the cluster name. The bucket is the state_bucket output of terraform/bootstrap}"
REGION="${2:?Pass the AWS region as the second argument, for example ap-south-1}"
CLUSTER="${3:?Pass the cluster name as the third argument, for example deployment-assistant-staging}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STACK="${ROOT}/terraform/service"

# Every service keeps its state at <PREFIX><service>/terraform.tfstate.
# The slash after the cluster name matters: without it, the cluster "demo" would also
# match the services of a cluster named "demo-prod".
PREFIX="deployment-assistant/services/${CLUSTER}/"
STATE_FILE="terraform.tfstate"
# The same rule for service names as in terraform/service/variables.tf.
NAME_PATTERN='^[a-z][a-z0-9-]{0,39}$'

# Ask S3 for the name (key) of every object under the prefix.
# The answer is one line of keys with tabs between them, or "None" when there are none.
KEYS="$(aws s3api list-objects-v2 --bucket "${BUCKET}" --prefix "${PREFIX}" --region "${REGION}" \
  --query 'Contents[].Key' --output text)"

# Work out the service names from the keys:
#   deployment-assistant/services/<cluster>/orders-api/terraform.tfstate  ->  orders-api
# Anything that is not a service's state file is skipped, for example the lock file
# (terraform.tfstate.tflock) that exists while a run is in progress.
SERVICES=()
while IFS= read -r key; do
  name="${key#"${PREFIX}"}"
  [[ "${name}" == *"/${STATE_FILE}" ]] || continue
  name="${name%"/${STATE_FILE}"}"
  [[ "${name}" =~ ${NAME_PATTERN} ]] || continue
  SERVICES+=("${name}")
done < <(printf '%s\n' "${KEYS}" | tr '\t' '\n')

if [ "${#SERVICES[@]}" -eq 0 ]; then
  echo "No service stacks found under s3://${BUCKET}/${PREFIX}"
  echo "Nothing was destroyed."
  exit 0
fi

echo "Service stacks of cluster ${CLUSTER}, found under s3://${BUCKET}/${PREFIX}"
for service in "${SERVICES[@]}"; do
  echo "  ${service}   (image repository ${CLUSTER}/${service})"
done
echo
echo "This deletes each of these image repositories and every image in them."
echo "It cannot be undone."
# "|| true": when there is no keyboard to read from, the answer is empty and the script stops below.
read -r -p "Type yes to go on: " ANSWER || true
if [ "${ANSWER:-}" != "yes" ]; then
  echo "Stopped. Nothing was destroyed."
  # Not 0, so that a command chained after this one (the cluster destroy) does not run.
  exit 1
fi

# Printed however the script ends, also when Terraform stops with an error halfway,
# so it is always clear which repositories are gone and which are not.
DESTROYED=()
summary() {
  echo
  echo "---- Cluster ${CLUSTER} ----"
  if [ "${#DESTROYED[@]}" -eq 0 ]; then
    echo "Nothing was destroyed."
  else
    echo "Destroyed, with every image in them:"
    for service in "${DESTROYED[@]}"; do
      echo "  ${CLUSTER}/${service}"
    done
  fi
  if [ "${#DESTROYED[@]}" -lt "${#SERVICES[@]}" ]; then
    echo "NOT destroyed, because the run stopped at the error above:"
    # The services are handled in order, so the ones left are the rest of the list.
    for service in "${SERVICES[@]:${#DESTROYED[@]}}"; do
      echo "  ${CLUSTER}/${service}"
    done
    echo "Fix the error and run this script again."
  fi
}
trap summary EXIT

for service in "${SERVICES[@]}"; do
  echo
  echo "==> ${CLUSTER}/${service}"

  # Connect the stack to this service's state file. -reconfigure: the one folder is
  # used for every service, and each service has its own key.
  terraform -chdir="${STACK}" init -input=false -reconfigure \
    -backend-config="bucket=${BUCKET}" \
    -backend-config="key=${PREFIX}${service}/${STATE_FILE}" \
    -backend-config="region=${REGION}" \
    -backend-config="use_lockfile=true" \
    -backend-config="encrypt=true" >/dev/null

  # -auto-approve: the question was asked once, above, for the whole list.
  terraform -chdir="${STACK}" destroy -input=false -auto-approve \
    -var "region=${REGION}" \
    -var "cluster_name=${CLUSTER}" \
    -var "service_name=${service}"

  DESTROYED+=("${service}")
done
