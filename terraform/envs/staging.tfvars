# Settings for the staging cluster: small and cheap.
# api_allowed_cidrs is not set here, because it is different for every person who
# runs Terraform. Pass it on the command line or as TF_VAR_api_allowed_cidrs.

environment  = "staging"
cluster_name = "deployment-assistant-staging"
owner        = "suhail"

node_instance_type = "t3.medium"
node_min_size      = 2
node_desired_size  = 2
node_max_size      = 3

vpc_cidr           = "10.0.0.0/16"
single_nat_gateway = true
log_retention_days = 7
