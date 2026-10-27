import test from "node:test";
import assert from "node:assert/strict";
import { validateBackend } from "../mobile/src/core/backend.mjs";
test("backend URL permits explicit private HTTP and HTTPS, rejects prefix lookalikes and malformed hosts", () => {
  for (const value of [
    "http://10.0.2.2:8787",
    "http://192.168.1.10:8787",
    "http://172.16.0.1",
    "http://127.0.0.1",
    "http://localhost:8787",
    "https://sync.example.com",
  ]) {
    assert.equal(validateBackend(value), value);
  }
  for (const value of [
    "http://10.evil.com",
    "http://127.0.0.1.evil.com",
    "http://192.168.example.com",
    "http://8.8.8.8",
    "http://172.32.0.1",
    "http://10.256.0.1",
    "http://user:pass@10.0.0.1",
    "https://example.com:99999",
    "ftp://10.0.0.1",
    "http://10.0.0.1/path",
  ]) {
    assert.throws(() => validateBackend(value));
  }
  assert.equal(
    validateBackend(" https://sync.example.com/// "),
    "https://sync.example.com"
  );
});
