import { ChevronDown } from "lucide-react";
import { useState } from "react";

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex justify-between items-center py-4 w-full text-left cursor-pointer"
      >
        <span className="text-sm font-medium text-text-primary">{q}</span>
        <ChevronDown
          size={16}
          className={`text-text-tertiary shrink-0 ml-4 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="pb-4 text-sm leading-relaxed text-text-secondary">
          {a}
        </div>
      )}
    </div>
  );
}

const FAQ_ITEMS = [
  {
    q: "What can Nexu do for me?",
    a: "Anything you can describe in a conversation: build websites and tools (auto-deployed and live), analyze data and generate reports, write blogs and newsletters, run scheduled automations, conduct competitive research, and more. Just say what you need in Slack / Discord / Telegram / WhatsApp, and your lobster delivers it.",
  },
  {
    q: "How is this different from ChatGPT / Claude?",
    a: "ChatGPT gives you answers. Nexu gives you results. The difference: 1) Your lobster lives in your IM — no extra window to open; 2) It doesn't just respond, it executes — code gets deployed, data analysis becomes a live dashboard; 3) It remembers your preferences — the more you use it, the smoother it gets; 4) It runs scheduled tasks automatically, without you having to watch.",
  },
  {
    q: "I don't know how to code. Can I still use it?",
    a: 'Absolutely. Just say "build me a ___" and your lobster handles all the technical details. For example, "build my daughter a vocabulary game" — it writes the code, deploys it, and gives you a link. You never touch a single line of code.',
  },
  {
    q: "Which chat apps are supported?",
    a: "Slack, Discord, Telegram, and WhatsApp. Each platform only needs a one-time bot setup — takes about 3 minutes. After that, 🦞 shows up in your group chats and DMs.",
  },
  {
    q: "Are the websites/tools it builds temporary?",
    a: "No. Every project is deployed to a unique URL that you can share with anyone. Pro plan supports custom domains and permanent hosting.",
  },
  {
    q: "Is my data safe?",
    a: "Every user's code and data is fully isolated, running in an independent sandbox environment. We never access or use your data.",
  },
];

export default function FAQSection() {
  return (
    <section
      id="faq"
      className="px-4 sm:px-6 py-16 sm:py-20 md:py-24 mx-auto max-w-2xl"
    >
      <div className="mb-14 text-center">
        <div className="text-[11px] font-semibold text-accent mb-3 tracking-widest uppercase">
          FAQ
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-text-primary">
          You might be wondering
        </h2>
      </div>
      <div>
        {FAQ_ITEMS.map((item) => (
          <FAQItem key={item.q} q={item.q} a={item.a} />
        ))}
      </div>
    </section>
  );
}
