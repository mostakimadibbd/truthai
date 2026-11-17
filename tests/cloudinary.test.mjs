import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyCloudinaryHttp,
  cloudinaryErrorMessage,
} from "../lib/server/cloudinary.ts";

test("cloudinaryErrorMessage extracts the SDK's nested message", () => {
  assert.equal(
    cloudinaryErrorMessage({ error: { message: "Invalid credentials", http_code: 401 } }),
    "Invalid credentials",
  );
  assert.equal(cloudinaryErrorMessage(new Error("Socket timeout")), "Socket timeout");
  assert.equal(cloudinaryErrorMessage(null), "Cloudinary rejected the upload.");
  // Anything resembling credential material is dropped wholesale.
  assert.equal(
    cloudinaryErrorMessage(new Error("cloudinary://key:secret@cloud failed")),
    "Cloudinary rejected the upload.",
  );
});

test("classifyCloudinaryHttp maps statuses to a fixed vocabulary", () => {
  assert.equal(classifyCloudinaryHttp(401, ""), "invalid_credentials");
  assert.equal(classifyCloudinaryHttp(400, "Unknown API key"), "invalid_credentials");
  assert.equal(classifyCloudinaryHttp(403, ""), "account_limited");
  assert.equal(classifyCloudinaryHttp(200, "Monthly limit exceeded"), "account_limited");
  assert.equal(classifyCloudinaryHttp(502, ""), "cloudinary_unavailable");
  assert.equal(classifyCloudinaryHttp(418, "teapot"), "unknown");
});
