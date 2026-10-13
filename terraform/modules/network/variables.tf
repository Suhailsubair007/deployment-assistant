variable "name" {
  description = "Name given to the VPC and used as a prefix for its parts."
  type        = string
}

variable "vpc_cidr" {
  description = "IP range of the VPC. Must be a /16, because the subnets are cut from it at fixed sizes."
  type        = string

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0)) && endswith(var.vpc_cidr, "/16")
    error_message = "vpc_cidr must be a valid /16 range, for example 10.0.0.0/16."
  }
}

variable "az_count" {
  description = "How many availability zones to spread the subnets over."
  type        = number
  default     = 2

  validation {
    condition     = var.az_count >= 2 && var.az_count <= 3
    error_message = "Use 2 or 3 availability zones."
  }
}

variable "single_nat_gateway" {
  description = "true: one NAT gateway for all zones. false: one NAT gateway in each zone."
  type        = bool
}

variable "tags" {
  description = "Tags for every resource in this module."
  type        = map(string)
}
