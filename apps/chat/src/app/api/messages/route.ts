import { NextResponse } from "next/server";
import { dispatchSessionChatTurn } from "../../../server/dispatch";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      threadId?: unknown;
      role?: unknown;
      body?: unknown;
    };

    const result = await dispatchSessionChatTurn({
      threadId: typeof body.threadId === "string" ? body.threadId : "",
      body: typeof body.body === "string" ? body.body : "",
    });

    return NextResponse.json({ result }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to create message.",
      },
      { status: 400 },
    );
  }
}
