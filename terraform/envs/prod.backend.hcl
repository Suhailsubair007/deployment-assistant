# Where the prod state lives inside the state bucket. A different key from staging
# means the two environments can never overwrite each other's state.
key          = "deployment-assistant/prod/terraform.tfstate"
encrypt      = true
use_lockfile = true
