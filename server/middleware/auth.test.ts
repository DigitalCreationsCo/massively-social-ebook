import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { isAdmin } from "./auth";

function app() { const a = express(); a.get("/x", isAdmin, (_q, r) => r.json({ ok: true })); return a; }

describe("isAdmin fail-closed", () => {
  it("rejects when ADMIN_TOKEN is unset and no token is sent", async () => {
    delete process.env.ADMIN_TOKEN;
    expect((await request(app()).get("/x")).status).toBe(401);
  });
  it("rejects when ADMIN_TOKEN is unset and a token IS sent", async () => {
    delete process.env.ADMIN_TOKEN;
    expect((await request(app()).get("/x").set("authorization", "Bearer anything")).status).toBe(401);
  });
  it("rejects an empty ADMIN_TOKEN", async () => {
    process.env.ADMIN_TOKEN = "";
    expect((await request(app()).get("/x").set("x-admin-token", "")).status).toBe(401);
  });
  it("accepts the configured token", async () => {
    process.env.ADMIN_TOKEN = "s3cret";
    expect((await request(app()).get("/x").set("authorization", "Bearer s3cret")).status).toBe(200);
  });
  it("rejects a wrong token", async () => {
    process.env.ADMIN_TOKEN = "s3cret";
    expect((await request(app()).get("/x").set("authorization", "Bearer nope")).status).toBe(401);
  });
  it("keeps the dev-token escape hatch outside production", async () => {
    process.env.ADMIN_TOKEN = "s3cret";
    process.env.NODE_ENV = "development";
    expect((await request(app()).get("/x").set("x-admin-token", "dev-token")).status).toBe(200);
  });
});
