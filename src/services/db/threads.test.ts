import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/services/db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/db/connection")>();
  return {
    ...actual,
    getDb: vi.fn(),
  };
});

import { getDb } from "@/services/db/connection";
import { muteThread, unmuteThread, getMutedThreadIds, deleteAllThreadsForAccount, setThreadLabels, addThreadLabels, getThreadsByIds } from "./threads";
import { createMockDb } from "@/test/mocks";

const mockDb = createMockDb();

describe("threads service - deleteAllThreadsForAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Awaited<ReturnType<typeof getDb>>);
  });

  it("deletes all threads for the given account", async () => {
    await deleteAllThreadsForAccount("acc-1");

    expect(mockDb.execute).toHaveBeenCalledWith(
      "DELETE FROM threads WHERE account_id = $1",
      ["acc-1"],
    );
  });
});

describe("threads service - mute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Awaited<ReturnType<typeof getDb>>);
  });

  describe("muteThread", () => {
    it("calls db.execute with correct SQL to set is_muted = 1", async () => {
      await muteThread("acc-1", "thread-1");

      expect(mockDb.execute).toHaveBeenCalledWith(
        "UPDATE threads SET is_muted = 1 WHERE account_id = $1 AND id = $2",
        ["acc-1", "thread-1"],
      );
    });
  });

  describe("unmuteThread", () => {
    it("calls db.execute with correct SQL to set is_muted = 0", async () => {
      await unmuteThread("acc-1", "thread-1");

      expect(mockDb.execute).toHaveBeenCalledWith(
        "UPDATE threads SET is_muted = 0 WHERE account_id = $1 AND id = $2",
        ["acc-1", "thread-1"],
      );
    });
  });

  describe("getMutedThreadIds", () => {
    it("returns a Set of muted thread IDs", async () => {
      mockDb.select.mockResolvedValueOnce([
        { id: "thread-1" },
        { id: "thread-3" },
      ]);

      const result = await getMutedThreadIds("acc-1");

      expect(mockDb.select).toHaveBeenCalledWith(
        "SELECT id FROM threads WHERE account_id = $1 AND is_muted = 1",
        ["acc-1"],
      );
      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(2);
      expect(result.has("thread-1")).toBe(true);
      expect(result.has("thread-3")).toBe(true);
    });

    it("returns an empty Set when no threads are muted", async () => {
      mockDb.select.mockResolvedValueOnce([]);

      const result = await getMutedThreadIds("acc-1");

      expect(result.size).toBe(0);
    });
  });
});

describe("threads service - setThreadLabels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Awaited<ReturnType<typeof getDb>>);
  });

  it("deletes existing labels and inserts new ones", async () => {
    await setThreadLabels("acc-1", "thread-1", ["INBOX", "SENT"]);

    expect(mockDb.execute).toHaveBeenNthCalledWith(
      1,
      "DELETE FROM thread_labels WHERE account_id = $1 AND thread_id = $2",
      ["acc-1", "thread-1"],
    );
    expect(mockDb.execute).toHaveBeenNthCalledWith(
      2,
      "INSERT OR IGNORE INTO thread_labels (account_id, thread_id, label_id) VALUES ($1, $2, $3)",
      ["acc-1", "thread-1", "INBOX"],
    );
    expect(mockDb.execute).toHaveBeenNthCalledWith(
      3,
      "INSERT OR IGNORE INTO thread_labels (account_id, thread_id, label_id) VALUES ($1, $2, $3)",
      ["acc-1", "thread-1", "SENT"],
    );
  });
});

describe("threads service - addThreadLabels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Awaited<ReturnType<typeof getDb>>);
  });

  it("adds labels without deleting existing ones", async () => {
    await addThreadLabels("acc-1", "thread-1", ["INBOX"]);

    // Should NOT delete existing labels
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
    expect(mockDb.execute).toHaveBeenCalledWith(
      "INSERT OR IGNORE INTO thread_labels (account_id, thread_id, label_id) VALUES ($1, $2, $3)",
      ["acc-1", "thread-1", "INBOX"],
    );
  });

  it("skips if label list is empty", async () => {
    await addThreadLabels("acc-1", "thread-1", []);

    expect(mockDb.execute).not.toHaveBeenCalled();
  });
});

describe("threads service - getThreadsByIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Awaited<ReturnType<typeof getDb>>);
  });

  it("returns a map of existing threads", async () => {
    mockDb.select.mockResolvedValueOnce([
      { id: "thread-1", account_id: "acc-1", message_count: 5 },
      { id: "thread-3", account_id: "acc-1", message_count: 2 },
    ]);

    const result = await getThreadsByIds("acc-1", ["thread-1", "thread-2", "thread-3"]);

    expect(result.size).toBe(2);
    expect(result.get("thread-1")?.message_count).toBe(5);
    expect(result.has("thread-2")).toBe(false);
    expect(result.get("thread-3")?.message_count).toBe(2);
  });

  it("returns empty map for empty input", async () => {
    const result = await getThreadsByIds("acc-1", []);

    expect(result.size).toBe(0);
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});
