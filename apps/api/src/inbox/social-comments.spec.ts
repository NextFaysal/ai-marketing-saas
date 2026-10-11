import { CommentClassifier } from "./comment-classifier";
import { CommentHumanizer } from "./comment-humanizer";

describe("CommentClassifier & CommentHumanizer", () => {
  it("accurately classifies price query intent and sentiment", () => {
    const text = "এটার দাম কত ভাইয়া? কোনো ডিসকাউন্ট আছে?";
    const result = CommentClassifier.classify(text);

    expect(result.intent).toBe("PRICE_QUERY");
    expect(result.sentiment).toBe("POSITIVE");
    expect(result.shouldHideOrDelete).toBe(false);
  });

  it("detects spam comments with links and triggers auto-hide flag", () => {
    const text = "ঘরে বসে প্রতিদিন ইনকাম করতে টেলিগ্রাম চ্যানেলে জয়েন করুন";
    const result = CommentClassifier.classify(text);

    expect(result.sentiment).toBe("SPAM");
    expect(result.shouldHideOrDelete).toBe(true);
  });

  it("detects negative complaints and triggers high priority flag", () => {
    const text = "একদম বাজে কোয়ালিটি, ২ দিনেই নষ্ট হয়ে গেছে! প্রোডাক্ট রিটার্ন চাই।";
    const result = CommentClassifier.classify(text);

    expect(result.sentiment).toBe("NEGATIVE");
    expect(result.intent).toBe("COMPLAINT");
    expect(result.isHighPriorityComplaint).toBe(true);
  });

  it("CommentHumanizer crafts natural Bengali reply with matched product price and private DM", () => {
    const classification = CommentClassifier.classify("দাম কত ভাই?");
    const reply = CommentHumanizer.generateHumanReply({
      authorName: "রাকিব হাসান",
      commentText: "দাম কত ভাই?",
      classification,
      matchedProduct: {
        name: "প্রিমিয়াম লেদার ওয়ালেট",
        priceFormatted: "১২৫০ টাকা",
        orderUrl: "https://shop.example/wallet",
      },
    });

    expect(reply.publicCommentReply).toContain("১২৫০ টাকা");
    expect(reply.publicCommentReply).toContain("রাকিব");
    expect(reply.shouldSendDm).toBe(true);
    expect(reply.privateDmText).toContain("https://shop.example/wallet");
  });
});
