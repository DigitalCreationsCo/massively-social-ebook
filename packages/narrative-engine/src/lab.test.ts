import { describe, it, expect, vi, beforeEach } from "vitest";
import { configureNarrativeLab, getActiveEngine, startLabServer } from "./lab";
import { NarrativeEngine } from "./engine";
import * as fs from "fs";

vi.mock("fs");
vi.mock("express", () => {
    const mockApp = {
        get: vi.fn(),
        post: vi.fn(),
        use: vi.fn(),
        listen: vi.fn((port, cb) => cb()),
    };
    return { default: () => mockApp };
});

describe("NarrativeLab Registry & Server", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Clear global symbol for clean tests
        const GLOBAL_KEY = Symbol.for("narrative.engine.registry");
        delete (global as any)[ GLOBAL_KEY ];
    });

    it("should provision a default engine if none is provided", () => {
        configureNarrativeLab();
        const engine = getActiveEngine();
        expect(engine).toBeInstanceOf(NarrativeEngine);
    });

    it("should return a new engine even if configure was never called", () => {
        const engine = getActiveEngine();
        expect(engine).toBeInstanceOf(NarrativeEngine);
    });

    it("should update config via /__narrative_lab/generate", async () => {
        configureNarrativeLab();
        const engine = getActiveEngine();
        const spy = vi.spyOn(engine, "setLabConfig");

        // Mocking the express req/res
        const req = { body: { channelId: "test", query: "hi", config: { weightDense: 0.1 } } };
        const res = { json: vi.fn() };

        // Find the POST handler from the mocked app
        const app = (require("express")).default();
        startLabServer();
        const handler = app.post.mock.calls.find((c: any) => c[ 0 ] === "/__narrative_lab/generate")[ 1 ];

        await handler(req, res);
        expect(spy).toHaveBeenCalledWith({ weightDense: 0.1 });
    });

    it("should handle missing trace files gracefully (ENOENT)", () => {
        vi.mocked(fs.readFileSync).mockImplementation(() => {
            const err = new Error() as any;
            err.code = 'ENOENT';
            throw err;
        });

        const app = (require("express") as any).default();
        startLabServer();
        const handler = app.get.mock.calls.find((c: any) => c[ 0 ] === "/__narrative_lab/traces")[ 1 ];

        const res = { json: vi.fn() };
        handler({}, res);
        expect(res.json).toHaveBeenCalledWith({ traces: [] });
    });
});

describe("NarrativeLab Security Gate", () => {
    let mockApp: any;
    let gateMiddleware: any;

    beforeEach(() => {
        vi.mock("express", () => {
            const mApp = {
                use: vi.fn((path, fn) => { if (path === "/__narrative_lab") gateMiddleware = fn; }),
                get: vi.fn(),
                post: vi.fn(),
                listen: vi.fn((port, host, cb) => cb()),
            };
            return { default: () => mApp, json: () => (req: any, res: any, next: any) => next() };
        });
        startLabServer();
    });

    it("should block requests with missing authorization", () => {
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
        const req = { socket: { remoteAddress: "127.0.0.1" }, headers: {} };

        gateMiddleware(req, res, () => { });

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
    });

    it("should block non-local requests even with a valid token", () => {
        const SESSION_SECRET = (global as any)[ Symbol.for("narrative.lab.token") ];
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
        const req = {
            socket: { remoteAddress: "192.168.1.5" },
            headers: { authorization: `Bearer ${SESSION_SECRET}` }
        };

        gateMiddleware(req, res, () => { });

        expect(res.status).toHaveBeenCalledWith(403);
    });

    it("should allow local requests with a valid token", () => {
        const SESSION_SECRET = (global as any)[ Symbol.for("narrative.lab.token") ];
        const next = vi.fn();
        const req = {
            socket: { remoteAddress: "127.0.0.1" },
            headers: { authorization: `Bearer ${SESSION_SECRET}` }
        };

        gateMiddleware(req, {}, next);

        expect(next).toHaveBeenCalled();
    });
});