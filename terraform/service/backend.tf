# Remote state in S3, with locking: the same bucket as the cluster stack, but one
# state file per service.
#
# The block is empty because backend settings cannot use variables. The assistant
# passes them to "terraform init" every time it runs this stack:
#
#   terraform init -reconfigure \
#     -backend-config="bucket=<state bucket>" \
#     -backend-config="key=deployment-assistant/services/<cluster_name>/<service_name>/terraform.tfstate" \
#     -backend-config="region=<region>" \
#     -backend-config="use_lockfile=true" \
#     -backend-config="encrypt=true"
#
# The key is different for every service and is never the cluster's key, so a run
# works on one service's state file only. It cannot change the cluster's state or
# another service's.
#
# -reconfigure is needed because this one folder is used for every service: it tells
# Terraform to switch to the new key without trying to move the previous state into it.
#
# The folder remembers only one key at a time. So runs for different services must
# not overlap: finish init and apply for one service before starting the next.
# Otherwise an apply could run against another service's state file.
terraform {
  backend "s3" {}
}
