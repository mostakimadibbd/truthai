import { NextResponse } from "next/server";

type PasswordCheckRequest = {
  prefix?: unknown;
  suffix?: unknown;
};

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim();
  const contentLength = Number(request.headers.get("content-length"));
  if (
    contentType !== "application/json" ||
    (Number.isFinite(contentLength) && contentLength > 256)
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  let body: PasswordCheckRequest;
  try {
    body = (await request.json()) as PasswordCheckRequest;
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  if (
    typeof body.prefix !== "string" ||
    !/^[0-9A-F]{5}$/i.test(body.prefix) ||
    typeof body.suffix !== "string" ||
    !/^[0-9A-F]{35}$/i.test(body.suffix)
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  let response: Response;
  try {
    response = await fetch(
      `https://api.pwnedpasswords.com/range/${body.prefix.toUpperCase()}`,
      {
        headers: { "Add-Padding": "true" },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      },
    );
  } catch {
    return NextResponse.json(
      { error: "password_check_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!response.ok) {
    return NextResponse.json(
      { error: "password_check_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  let lines: string[];
  try {
    lines = (await response.text()).split(/\r?\n/);
  } catch {
    return NextResponse.json(
      { error: "password_check_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const suffix = body.suffix.toUpperCase();
  const pwned = lines.some((line) => {
    const [candidate, count] = line.split(":");
    return candidate?.toUpperCase() === suffix && Number(count) > 0;
  });

  return NextResponse.json(
    { pwned },
    { headers: { "Cache-Control": "no-store" } },
  );
}
