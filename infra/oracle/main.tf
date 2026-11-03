data "oci_identity_availability_domains" "ads" {
  compartment_id = var.tenancy_ocid
}

resource "oci_core_vcn" "apollo" {
  compartment_id = var.compartment_ocid
  display_name   = "apollo-production-vcn"
  cidr_block     = var.vcn_cidr
  dns_label      = "apollo"
}

resource "oci_core_internet_gateway" "apollo" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.apollo.id
  display_name   = "apollo-production-igw"
  enabled        = true
}

resource "oci_core_route_table" "public" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.apollo.id
  display_name   = "apollo-public-routes"
  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.apollo.id
  }
}

resource "oci_core_network_security_group" "edge" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.apollo.id
  display_name   = "apollo-edge-nsg"
}

resource "oci_core_network_security_group_security_rule" "https" {
  network_security_group_id = oci_core_network_security_group.edge.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = "0.0.0.0/0"
  source_type               = "CIDR_BLOCK"
  tcp_options { destination_port_range { min = 443 max = 443 } }
}

resource "oci_core_network_security_group_security_rule" "http" {
  network_security_group_id = oci_core_network_security_group.edge.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = "0.0.0.0/0"
  source_type               = "CIDR_BLOCK"
  tcp_options { destination_port_range { min = 80 max = 80 } }
}

resource "oci_core_network_security_group_security_rule" "ssh" {
  network_security_group_id = oci_core_network_security_group.edge.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = var.admin_cidr
  source_type               = "CIDR_BLOCK"
  tcp_options { destination_port_range { min = 22 max = 22 } }
}

resource "oci_core_network_security_group_security_rule" "egress" {
  network_security_group_id = oci_core_network_security_group.edge.id
  direction                 = "EGRESS"
  protocol                  = "all"
  destination               = "0.0.0.0/0"
  destination_type          = "CIDR_BLOCK"
}

resource "oci_core_subnet" "public" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.apollo.id
  display_name               = "apollo-public-subnet"
  cidr_block                 = var.subnet_cidr
  route_table_id             = oci_core_route_table.public.id
  security_list_ids          = []
  prohibit_public_ip_on_vnic = false
  dns_label                  = "public"
}

resource "oci_core_instance" "apollo" {
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[var.availability_domain_number - 1].name
  compartment_id      = var.compartment_ocid
  display_name        = var.instance_name
  shape               = var.instance_shape

  shape_config {
    ocpus         = var.instance_ocpus
    memory_in_gbs = var.instance_memory_gb
  }

  source_details {
    source_type             = "image"
    source_id               = var.image_ocid
    boot_volume_size_in_gbs = var.boot_volume_size_gb
  }

  create_vnic_details {
    subnet_id                 = oci_core_subnet.public.id
    assign_public_ip          = true
    nsg_ids                   = [oci_core_network_security_group.edge.id]
    assign_private_dns_record = true
    hostname_label            = "apollo"
  }

  metadata = {
    ssh_authorized_keys = var.ssh_public_key
    user_data = base64encode(file("${path.module}/cloud-init.yaml"))
  }

  preserve_boot_volume = true
}

output "apollo_public_ip" {
  value       = oci_core_instance.apollo.public_ip
  description = "Public IP for DNS A records after the host is provisioned."
}
output "apollo_private_ip" { value = oci_core_instance.apollo.private_ip }
