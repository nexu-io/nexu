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
    q: "What is Nexu?",
    a: "Nexu is the simplest OpenClaw for teams - deploy in under a minute, with persistent memory and 1,000+ built-in tools. Always on in Slack, Discord and Telegram. Zero data loss, always learning.",
  },
  {
    q: "How is Nexu different from self-hosting OpenClaw?",
    a: "Nexu is hosted and ready in under a minute - no YAML, no server. You get persistent memory (OpenClaw sessions are stateless), 1,000+ tools out of the box, automatic updates, and team-level context across channels.",
  },
  {
    q: "Do I need to know how to code?",
    a: "No. Just add nexu to your team chat and describe what you need - no code, no setup. Your AI runs with 1,000+ built-in tools and skills.",
  },
  {
    q: "Which team chat platforms are supported?",
    a: "Slack, Discord, and Telegram. Add the bot to your workspace or group - your AI joins in under a minute and is 24/7 next to your team.",
  },
  {
    q: "How does Nexu understand my team?",
    a: "Nexu has persistent memory and learns from everyday work chat. It understands you and your team over time - no repeating yourself. The more you use it, the sharper it gets.",
  },
  {
    q: "Is my data safe?",
    a: "Every user's code and data runs in a fully isolated cloud sandbox. We never access or use your data.",
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
          Frequently Asked Questions
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
