variable "tenancy_ocid" {
  type = string
}

variable "user_ocid" {
  type = string
}

variable "fingerprint" {
  type = string
}

variable "private_key_path" {
  type = string
}

variable "region" {
  type = string
}

variable "compartment_ocid" {
  type = string
}

variable "availability_domain_number" {
  type    = number
  default = 1
}

variable "image_ocid" {
  description = "Ubuntu 22.04/24.04 ARM64 image OCID for the selected OCI region."
  type        = string
}

variable "ssh_public_key" {
  type = string
}

variable "admin_cidr" {
  description = "Your fixed public IP in CIDR notation; SSH is never opened to the world."
  type        = string

  validation {
    condition     = can(cidrnetmask(var.admin_cidr))
    error_message = "admin_cidr must be a valid IPv4 CIDR."
  }
}

variable "instance_shape" {
  type    = string
  default = "VM.Standard.A1.Flex"
}

variable "instance_ocpus" {
  type    = number
  default = 4
}

variable "instance_memory_gb" {
  type    = number
  default = 24
}

variable "boot_volume_size_gb" {
  type    = number
  default = 100
}

variable "vcn_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "subnet_cidr" {
  type    = string
  default = "10.20.1.0/24"
}

variable "instance_name" {
  type    = string
  default = "apollo-production-01"
}
