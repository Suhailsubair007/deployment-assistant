# ---- Which service, in which cluster ----
#
# The assistant passes these three on every run. They have no default on purpose:
# a run that does not say where it belongs must stop, not guess.

variable "region" {
  description = "AWS region to create the repository in. Must be the region of the cluster, because the address the cluster pulls images from contains it."
  type        = string
}

variable "cluster_name" {
  description = "Name of the EKS cluster the service is deployed to. It is the first part of the repository name."
  type        = string

  validation {
    condition     = length(var.cluster_name) > 0
    error_message = "cluster_name must not be empty."
  }
}

variable "service_name" {
  description = "Name of the service, as given in the chat. It is the second part of the repository name."
  type        = string

  # The same rule the chat applies. It is repeated here so that a wrong name is
  # refused before anything is created, whoever runs this stack.
  validation {
    condition     = can(regex("^[a-z][a-z0-9]*(-[a-z0-9]+)*$", var.service_name)) && length(var.service_name) <= 40
    error_message = "service_name must start with a lowercase letter, use only lowercase letters, digits and single dashes, not end with a dash, and be at most 40 characters long."
  }
}

# ---- Tags ----

variable "owner" {
  description = "Who is responsible for the repository, used as the owner tag."
  type        = string
  default     = "deployment-assistant"
}

variable "project" {
  description = "Project name, used as the project tag. The same value as in the cluster stack, so one tag search finds everything."
  type        = string
  default     = "deployment-assistant"
}
