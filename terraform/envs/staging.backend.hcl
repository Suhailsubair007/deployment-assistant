# Where the staging state lives inside the state bucket.
# The bucket name and region are passed on the command line (see README.md).
key          = "deployment-assistant/staging/terraform.tfstate"
encrypt      = true
use_lockfile = true # state locking: a lock file next to the state, written atomically by S3
