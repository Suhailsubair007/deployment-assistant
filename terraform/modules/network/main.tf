# The network the cluster lives in.
#
#   public subnets   hold the NAT gateway (and load balancers, if any are added later)
#   private subnets  hold the worker nodes, which get no public IP address
#
# Nodes reach the internet only outwards, through the NAT gateway, for example to
# pull container images. Nothing on the internet can open a connection to a node.
#
# The community VPC module creates the route tables, internet gateway, NAT gateway
# and their wiring. What is decided here: the subnet layout, private-only nodes,
# how many NAT gateways, and the tags EKS uses to find the subnets.

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, var.az_count)

  # From a /16 such as 10.0.0.0/16:
  #   private: 10.0.0.0/20, 10.0.16.0/20, ...     about 4000 addresses each (every pod takes one)
  #   public:  10.0.100.0/24, 10.0.101.0/24, ...  about 250 addresses each
  private_subnets = [for index, az in local.azs : cidrsubnet(var.vpc_cidr, 4, index)]
  public_subnets  = [for index, az in local.azs : cidrsubnet(var.vpc_cidr, 8, 100 + index)]
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "6.7.3"

  name = var.name
  cidr = var.vpc_cidr
  azs  = local.azs

  private_subnets = local.private_subnets
  public_subnets  = local.public_subnets

  enable_nat_gateway     = true
  single_nat_gateway     = var.single_nat_gateway
  one_nat_gateway_per_az = !var.single_nat_gateway

  enable_dns_hostnames    = true
  map_public_ip_on_launch = false

  # EKS looks for these tags to decide where load balancers may be placed.
  public_subnet_tags  = { "kubernetes.io/role/elb" = "1" }
  private_subnet_tags = { "kubernetes.io/role/internal-elb" = "1" }

  tags = var.tags
}
