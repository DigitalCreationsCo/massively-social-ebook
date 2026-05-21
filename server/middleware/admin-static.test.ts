import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import fs from "fs";
import path from "path";
import { createAdminStaticMiddleware } from "./admin-static";

describe("Admin Static Middleware", () => {
  let appExpressTest: express.Express;
  let envOriginal: NodeJS.ProcessEnv;

  beforeEach(() => {
    envOriginal = { ...process.env };
    process.env.NODE_ENV = "production";
    process.env.ADMIN_USERNAME = "testadmin";
    process.env.ADMIN_PASSWORD = "testpassword";

    appExpressTest = express();
    appExpressTest.use(createAdminStaticMiddleware());
    appExpressTest.use((req, res) => {
      res.send("fallback next handler reached");
    });
  });

  afterEach(() => {
    process.env = envOriginal;
    vi.restoreAllMocks();
  });

  it("should call next() for non-admin hosts and non-admin paths", async () => {
    const responseHostPath = await request(appExpressTest)
      .get("/some-other-path")
      .set("Host", "www.25thchapter.com");

    expect(responseHostPath.status).toBe(200);
    expect(responseHostPath.text).toBe("fallback next handler reached");
  });

  it("should bypass Basic Auth if process.env.ADMIN_PASSWORD is not set", async () => {
    delete process.env.ADMIN_PASSWORD;

    const spyExists = vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const spyStat = vi.spyOn(fs, "statSync").mockReturnValue({ isFile: () => true } as any);
    const spySendFile = vi.spyOn(express.response, "sendFile").mockImplementation(function (
      this: any,
      filePath: string
    ) {
      return this.send(`mocked sendFile: ${filePath}`);
    });

    const responseAuthBypass = await request(appExpressTest)
      .get("/")
      .set("Host", "control.25thchapter.com");

    expect(responseAuthBypass.status).toBe(200);
    expect(responseAuthBypass.text).toContain("mocked sendFile");
  });

  it("should return 401 if ADMIN_PASSWORD is set but authorization header is missing", async () => {
    const responseAuthMissing = await request(appExpressTest)
      .get("/")
      .set("Host", "control.25thchapter.com");

    expect(responseAuthMissing.status).toBe(401);
    expect(responseAuthMissing.headers["www-authenticate"]).toBe('Basic realm="401"');
  });

  it("should return 401 if authorization header contains invalid credentials", async () => {
    const authHeaderInvalidBase64 = Buffer.from("wronguser:wrongpass").toString("base64");
    const responseAuthInvalid = await request(appExpressTest)
      .get("/")
      .set("Host", "control.25thchapter.com")
      .set("Authorization", `Basic ${authHeaderInvalidBase64}`);

    expect(responseAuthInvalid.status).toBe(401);
  });

  it("should return 401 if authorization header is malformed and fails decoding", async () => {
    // Malformed base64 might not fail toString, but we can force split to fail by mocking Buffer.from or split
    const spyBuffer = vi.spyOn(Buffer, "from").mockImplementation(() => {
      throw new Error("Decoding failed mock error");
    });

    const responseAuthMalformed = await request(appExpressTest)
      .get("/")
      .set("Host", "control.25thchapter.com")
      .set("Authorization", "Basic malformedheader");

    expect(responseAuthMalformed.status).toBe(401);
  });

  it("should serve static file if user is authenticated and target file exists", async () => {
    const authHeaderValidBase64 = Buffer.from("testadmin:testpassword").toString("base64");

    const spyExists = vi.spyOn(fs, "existsSync").mockImplementation((filePathToCheck: any) => {
      // The dist dir exists, and the file itself exists
      return true;
    });
    const spyStat = vi.spyOn(fs, "statSync").mockReturnValue({ isFile: () => true } as any);
    const spySendFile = vi.spyOn(express.response, "sendFile").mockImplementation(function (
      this: any,
      filePath: string
    ) {
      return this.send(`mocked sendFile: ${filePath}`);
    });

    const responseStaticFile = await request(appExpressTest)
      .get("/assets/index.js")
      .set("Host", "control.25thchapter.com")
      .set("Authorization", `Basic ${authHeaderValidBase64}`);

    expect(responseStaticFile.status).toBe(200);
    expect(responseStaticFile.text).toContain("assets/index.js");
  });

  it("should serve fallback index.html if target file is not a direct file or does not exist", async () => {
    const authHeaderValidBase64 = Buffer.from("testadmin:testpassword").toString("base64");

    const spyExists = vi.spyOn(fs, "existsSync").mockImplementation((filePathToCheck: any) => {
      // The dist dir exists, but let's say the target file does not
      if (typeof filePathToCheck === "string" && filePathToCheck.endsWith("index.html")) {
        return true;
      }
      if (typeof filePathToCheck === "string" && filePathToCheck.endsWith("dist")) {
        return true;
      }
      return false;
    });

    const spySendFile = vi.spyOn(express.response, "sendFile").mockImplementation(function (
      this: any,
      filePath: string
    ) {
      return this.send(`mocked index.html: ${filePath}`);
    });

    const responseIndexFallback = await request(appExpressTest)
      .get("/dashboard")
      .set("Host", "control.25thchapter.com")
      .set("Authorization", `Basic ${authHeaderValidBase64}`);

    expect(responseIndexFallback.status).toBe(200);
    expect(responseIndexFallback.text).toContain("index.html");
  });

  it("should return 500 in production if admin/dist folder does not exist", async () => {
    const authHeaderValidBase64 = Buffer.from("testadmin:testpassword").toString("base64");

    const spyExists = vi.spyOn(fs, "existsSync").mockReturnValue(false);

    const responseNoDistProd = await request(appExpressTest)
      .get("/")
      .set("Host", "control.25thchapter.com")
      .set("Authorization", `Basic ${authHeaderValidBase64}`);

    expect(responseNoDistProd.status).toBe(500);
    expect(responseNoDistProd.text).toBe("Admin app not built.");
  });

  it("should call next() in non-production if admin/dist folder does not exist", async () => {
    process.env.NODE_ENV = "development";
    const authHeaderValidBase64 = Buffer.from("testadmin:testpassword").toString("base64");

    const spyExists = vi.spyOn(fs, "existsSync").mockReturnValue(false);

    const responseNoDistDev = await request(appExpressTest)
      .get("/")
      .set("Host", "control.25thchapter.com")
      .set("Authorization", `Basic ${authHeaderValidBase64}`);

    expect(responseNoDistDev.status).toBe(200);
    expect(responseNoDistDev.text).toBe("fallback next handler reached");
  });

  it("should return 403 on path traversal attempt outside admin dist", () => {
    const authHeaderValidBase64 = Buffer.from("testadmin:testpassword").toString("base64");

    const middleware = createAdminStaticMiddleware();
    const mockReq = {
      hostname: "control.25thchapter.com",
      path: "/../etc/passwd",
      headers: {
        authorization: `Basic ${authHeaderValidBase64}`
      }
    } as any;

    let responseStatus: number | undefined;
    let responseSentData: any;
    const mockRes = {
      status(code: number) {
        responseStatus = code;
        return this;
      },
      send(data: any) {
        responseSentData = data;
        return this;
      }
    } as any;

    const mockNext = vi.fn();

    middleware(mockReq, mockRes, mockNext);

    expect(responseStatus).toBe(403);
    expect(responseSentData).toBe("Forbidden");
    expect(mockNext).not.toHaveBeenCalled();
  });

  it("should return 500 if error occurs during fs existence checking", async () => {
    const authHeaderValidBase64 = Buffer.from("testadmin:testpassword").toString("base64");

    const spyExists = vi.spyOn(fs, "existsSync").mockImplementation((filePathToCheck: any) => {
      if (typeof filePathToCheck === "string" && filePathToCheck.endsWith("dist")) {
        return true;
      }
      throw new Error("FileSystem error simulation");
    });

    const responseFsError = await request(appExpressTest)
      .get("/somefile.js")
      .set("Host", "control.25thchapter.com")
      .set("Authorization", `Basic ${authHeaderValidBase64}`);

    expect(responseFsError.status).toBe(500);
    expect(responseFsError.text).toBe("Internal Server Error");
  });
});
