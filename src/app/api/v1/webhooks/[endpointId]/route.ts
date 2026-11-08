import { container } from "@/server/container";

const MAX_BYTES = 1024 * 1024;

export async function POST(req: Request, { params }: { params: Promise<{ endpointId: string }> }) {
  const { endpointId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(endpointId)) return Response.json({ code: "NOT_FOUND" }, { status: 404 });
  // Hard cap before reading the body; the per-endpoint limit is checked again inside.
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return Response.json({ code: "PAYLOAD_TOO_LARGE", message: "Body exceeds 1 MB." }, { status: 413 });
  const raw = await req.text();
  if (Buffer.byteLength(raw) > MAX_BYTES) return Response.json({ code: "PAYLOAD_TOO_LARGE", message: "Body exceeds 1 MB." }, { status: 413 });
  const res = await container().ingest.ingest(endpointId, raw, req.headers, { key: new URL(req.url).searchParams.get("key") });
  return Response.json(res.body, { status: res.status, headers: res.headers });
}
