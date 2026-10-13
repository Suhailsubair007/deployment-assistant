# Remote state in S3, with locking.
#
# The block is empty because backend settings cannot use variables. The bucket and
# the state file path are passed to "terraform init" instead (see README.md):
#
#   terraform init \
#     -backend-config="bucket=<state bucket>" \
#     -backend-config="region=<region>" \
#     -backend-config=envs/staging.backend.hcl
terraform {
  backend "s3" {}
}
