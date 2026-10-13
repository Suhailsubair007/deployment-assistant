import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { KubeGateway } from "@/cluster/kubeGateway.ts";

// A kubeconfig with one cluster and two logins for it, as scripts/kind-restricted-context.sh makes.
// Reading it needs no cluster: nothing is sent until the first call.
const KUBECONFIG = `
apiVersion: v1
kind: Config
current-context: admin
clusters:
  - name: shared-cluster
    cluster:
      server: https://127.0.0.1:6443
users:
  - name: admin-user
    user:
      token: not-a-real-token
  - name: restricted-user
    user:
      token: not-a-real-token
contexts:
  - name: admin
    context:
      cluster: shared-cluster
      user: admin-user
  - name: restricted
    context:
      cluster: shared-cluster
      user: restricted-user
`;

const file = join(mkdtempSync(join(tmpdir(), "kubeconfig-")), "config");
writeFileSync(file, KUBECONFIG);
process.env.KUBECONFIG = file;

test("the context name is the login that was asked for", () => {
  assert.equal(new KubeGateway("restricted").contextName(), "restricted");
});

test("two logins for one cluster give the same cluster name, so they share one history", () => {
  assert.equal(new KubeGateway("admin").clusterName(), "shared-cluster");
  assert.equal(new KubeGateway("restricted").clusterName(), "shared-cluster");
});
