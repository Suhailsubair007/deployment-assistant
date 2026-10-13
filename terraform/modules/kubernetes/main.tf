# What the Deployment Assistant needs inside the cluster: its namespaces, and the
# smallest set of permissions that lets it do its job in those namespaces only.
#
# The rules below are the same as in k8s/local/assistant-rbac.yaml, which is used to
# test them on a local kind cluster. Change both together.

resource "kubernetes_namespace_v1" "environment" {
  for_each = toset(var.namespaces)

  metadata {
    name = each.value

    labels = {
      "app.kubernetes.io/managed-by" = "terraform"
    }
  }
}

# A Role is valid in one namespace only. One copy is created per environment.
# Each rule lists the calls the assistant really makes, and nothing else:
# no delete, no secrets, no exec into pods.
resource "kubernetes_role_v1" "assistant" {
  for_each = kubernetes_namespace_v1.environment

  metadata {
    name      = "deployment-assistant"
    namespace = each.value.metadata[0].name
  }

  # Deploy, scale and roll back: read the Deployment, create it, replace it.
  rule {
    api_groups = ["apps"]
    resources  = ["deployments"]
    verbs      = ["get", "create", "update"]
  }

  # The Service in front of the pods.
  rule {
    api_groups = [""]
    resources  = ["services"]
    verbs      = ["get", "create", "update"]
  }

  # GET /health through the Service.
  rule {
    api_groups = [""]
    resources  = ["services/proxy"]
    verbs      = ["get"]
  }

  # Pod states and restart counts.
  rule {
    api_groups = [""]
    resources  = ["pods"]
    verbs      = ["list"]
  }

  # The last log lines of a crashing pod.
  rule {
    api_groups = [""]
    resources  = ["pods/log"]
    verbs      = ["get"]
  }

  # Why a pod is not ready, for example a failing readiness probe.
  rule {
    api_groups = [""]
    resources  = ["events"]
    verbs      = ["list"]
  }

  # Lets the assistant tell "namespace is missing" apart from "app is not deployed".
  rule {
    api_groups = [""]
    resources  = ["namespaces"]
    verbs      = ["get"]
  }

  # CPU and memory per pod, from metrics-server.
  rule {
    api_groups = ["metrics.k8s.io"]
    resources  = ["pods"]
    verbs      = ["list"]
  }
}

resource "kubernetes_role_binding_v1" "assistant" {
  for_each = kubernetes_role_v1.assistant

  metadata {
    name      = "deployment-assistant"
    namespace = each.value.metadata[0].namespace
  }

  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "Role"
    name      = each.value.metadata[0].name
  }

  subject {
    api_group = "rbac.authorization.k8s.io"
    kind      = "Group"
    name      = var.assistant_group
  }
}

# Nodes do not belong to any namespace, so a namespaced Role cannot allow reading
# them. This ClusterRole allows only that: listing nodes and their usage, read-only.
resource "kubernetes_cluster_role_v1" "assistant_nodes" {
  metadata {
    name = "deployment-assistant-nodes-read"
  }

  rule {
    api_groups = [""]
    resources  = ["nodes"]
    verbs      = ["list"]
  }

  rule {
    api_groups = ["metrics.k8s.io"]
    resources  = ["nodes"]
    verbs      = ["list"]
  }
}

resource "kubernetes_cluster_role_binding_v1" "assistant_nodes" {
  metadata {
    name = "deployment-assistant-nodes-read"
  }

  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "ClusterRole"
    name      = kubernetes_cluster_role_v1.assistant_nodes.metadata[0].name
  }

  subject {
    api_group = "rbac.authorization.k8s.io"
    kind      = "Group"
    name      = var.assistant_group
  }
}
