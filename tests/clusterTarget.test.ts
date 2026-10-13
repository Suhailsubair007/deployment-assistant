import assert from "node:assert/strict";
import { test } from "node:test";

import { describeCluster } from "@/build/clusterTarget.ts";

test("a kind cluster is recognised by its name, and the kind- in front is dropped", () => {
  assert.deepEqual(describeCluster("kind-deploy-assistant"), { kind: "kind", kindCluster: "deploy-assistant" });
});

test("an EKS cluster gives its region, account, name and image registry", () => {
  const target = describeCluster("arn:aws:eks:ap-south-1:123456789012:cluster/deployment-assistant-staging");

  assert.deepEqual(target, {
    kind: "eks",
    region: "ap-south-1",
    account: "123456789012",
    cluster: "deployment-assistant-staging",
    registry: "123456789012.dkr.ecr.ap-south-1.amazonaws.com/deployment-assistant-staging",
  });
});

test("any other cluster is one the assistant cannot build for", () => {
  assert.deepEqual(describeCluster("docker-desktop"), { kind: "other" });
  assert.deepEqual(describeCluster("minikube"), { kind: "other" });
  assert.deepEqual(describeCluster(""), { kind: "other" });
});

test("kind- with nothing usable behind it is not a kind cluster", () => {
  assert.deepEqual(describeCluster("kind-"), { kind: "other" });
  // Would otherwise be read as an option by "kind load docker-image --name".
  assert.deepEqual(describeCluster("kind---all"), { kind: "other" });
});

test("a malformed EKS name is not treated as EKS", () => {
  const malformed = [
    // No account.
    "arn:aws:eks:ap-south-1:cluster/deployment-assistant-staging",
    // The account is not 12 digits.
    "arn:aws:eks:ap-south-1:12345:cluster/deployment-assistant-staging",
    // Not a cluster.
    "arn:aws:eks:ap-south-1:123456789012:nodegroup/deployment-assistant-staging",
    // No cluster name.
    "arn:aws:eks:ap-south-1:123456789012:cluster/",
    // Something after the cluster name.
    "arn:aws:eks:ap-south-1:123456789012:cluster/staging/extra",
    // Another AWS service.
    "arn:aws:ecs:ap-south-1:123456789012:cluster/deployment-assistant-staging",
    // Text around a valid name.
    "x arn:aws:eks:ap-south-1:123456789012:cluster/staging",
  ];

  for (const name of malformed) {
    assert.deepEqual(describeCluster(name), { kind: "other" }, name);
  }
});
