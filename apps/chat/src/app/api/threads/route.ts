import { NextResponse } from "next/server";
import { createSessionChatThread } from "../../../server/db";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { title?: unknown };
    const title = typeof body.title === "string" ? body.title : "";
    const thread = await createSessionChatThread(title);
    return NextResponse.json({ thread }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to create thread.",
      },
      { status: 400 },
    );
  }
}
