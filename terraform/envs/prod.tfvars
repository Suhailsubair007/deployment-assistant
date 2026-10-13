# Settings for the prod cluster: more nodes, and no single point of failure for
# outbound traffic. Same code as staging; only these values differ.

environment  = "prod"
cluster_name = "deployment-assistant-prod"
owner        = "suhail"

node_instance_type = "t3.large"
node_min_size      = 3
node_desired_size  = 3
node_max_size      = 6

vpc_cidr           = "10.1.0.0/16"
single_nat_gateway = false
log_retention_days = 90
