"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import { bookMeta, chapters, type Chapter } from "./book-data";

type Theme = "light" | "sepia" | "dark";
type FontSize = "small" | "medium" | "large";

type ReaderStorage = {
  version: 1;
  chapterId: string;
  scrollY: number;
  theme: Theme;
  fontSize: FontSize;
  savedAt: number;
};

type SearchResult = {
  chapter: Chapter;
  snippet: string;
  score: number;
};

type MetaShape = Partial<{
  title: string;
  subtitle: string;
  authors: string[];
  publisher: string;
  year: string;
  notice: string;
  cover: string;
}>;

const STORAGE_KEY = "mastering-your-phd-reader-state-v1";
const THEMES: ReadonlyArray<{ value: Theme; label: string }> = [
  { value: "light", label: "明亮" },
  { value: "sepia", label: "护眼" },
  { value: "dark", label: "深色" },
];
const FONT_SIZES: ReadonlyArray<{ value: FontSize; label: string }> = [
  { value: "small", label: "小" },
  { value: "medium", label: "中" },
  { value: "large", label: "大" },
];
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const meta = bookMeta as MetaShape;
const title = meta.title?.trim() || "掌控你的博士生涯";
const subtitle = meta.subtitle?.trim() || "博士岁月及未来的生存与成功";
const authors = meta.authors?.filter(Boolean) || [];
const notice =
  meta.notice?.trim() || "已获授权发布 · 仅供个人学习和研究";

function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "sepia" || value === "dark";
}

function isFontSize(value: unknown): value is FontSize {
  return value === "small" || value === "medium" || value === "large";
}

function parseStoredState(raw: string | null): ReaderStorage | null {
  if (!raw) return null;

  try {
    const value = JSON.parse(raw) as Partial<ReaderStorage>;
    if (
      value.version !== 1 ||
      typeof value.chapterId !== "string" ||
      typeof value.scrollY !== "number" ||
      !Number.isFinite(value.scrollY) ||
      !isTheme(value.theme) ||
      !isFontSize(value.fontSize)
    ) {
      return null;
    }

    return {
      version: 1,
      chapterId: value.chapterId,
      scrollY: Math.max(0, value.scrollY),
      theme: value.theme,
      fontSize: value.fontSize,
      savedAt: typeof value.savedAt === "number" ? value.savedAt : 0,
    };
  } catch {
    return null;
  }
}

function readStoredState(): ReaderStorage | null {
  try {
    return parseStoredState(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeStoredState(value: ReaderStorage) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Reading remains fully functional when storage is unavailable or full.
  }
}

function currentHashId(): string {
  try {
    return decodeURIComponent(window.location.hash.slice(1));
  } catch {
    return window.location.hash.slice(1);
  }
}

function publicAssetPath(path: string | undefined): string | undefined {
  const value = path?.trim();
  if (!value) return undefined;
  if (/^(?:https?:|data:|blob:|\/)/i.test(value)) return value;
  return value.replace(/^\.\//, "");
}

function formatChapterNumber(index: number): string {
  return new Intl.NumberFormat("zh-CN", {
    minimumIntegerDigits: 2,
    useGrouping: false,
  }).format(index + 1);
}

function chapterMarker(chapter: Chapter, index: number): string {
  const match = /^ch(\d+)$/i.exec(chapter.id);
  if (match) return match[1].padStart(2, "0");

  const frontMatter: Record<string, string> = {
    title: "书",
    copyright: "版",
    front: "序",
    acknowledgements: "谢",
    authors: "作",
  };
  return frontMatter[chapter.id] || formatChapterNumber(index);
}

function chapterKicker(chapter: Chapter, index: number): string {
  const match = /^ch(\d+)$/i.exec(chapter.id);
  if (match) return `第 ${match[1].padStart(2, "0")} 章`;

  const frontMatter: Record<string, string> = {
    title: "书籍信息",
    copyright: "版权说明",
    front: "前言",
    acknowledgements: "致谢",
    authors: "作者简介",
  };
  return frontMatter[chapter.id] || `阅读单元 ${formatChapterNumber(index)}`;
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function makeSnippet(text: string, query: string): string {
  const source = compactText(text);
  const needle = query.toLocaleLowerCase("zh-CN");
  const index = source.toLocaleLowerCase("zh-CN").indexOf(needle);
  const center = index >= 0 ? index : 0;
  const start = Math.max(0, center - 46);
  const end = Math.min(source.length, center + query.length + 78);
  const excerpt = source.slice(start, end).trim();

  return `${start > 0 ? "…" : ""}${excerpt}${end < source.length ? "…" : ""}`;
}

function markMatch(text: string, query: string): ReactNode {
  const needle = query.trim();
  if (!needle) return text;

  const index = text
    .toLocaleLowerCase("zh-CN")
    .indexOf(needle.toLocaleLowerCase("zh-CN"));
  if (index < 0) return text;

  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + needle.length)}</mark>
      {text.slice(index + needle.length)}
    </>
  );
}

function trapDialogFocus(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;

  const focusable = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((element) => !element.hasAttribute("hidden"));
  if (focusable.length === 0) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;

  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

type TocProps = {
  activeId: string;
  onNavigate: (id: string) => void;
  variant: "desktop" | "mobile";
};

function TableOfContents({ activeId, onNavigate, variant }: TocProps) {
  return (
    <nav
      className={`chapter-toc chapter-toc--${variant}`}
      aria-label="全书章节"
    >
      <ol className="chapter-toc__list">
        {chapters.map((chapter, index) => {
          const isActive = chapter.id === activeId;
          return (
            <li
              className={`chapter-toc__item${isActive ? " is-active" : ""}`}
              key={chapter.id}
            >
              <a
                className="chapter-toc__link"
                href={`#${chapter.id}`}
                aria-current={isActive ? "location" : undefined}
                onClick={() => onNavigate(chapter.id)}
              >
                <span className="chapter-toc__number" aria-hidden="true">
                  {chapterMarker(chapter, index)}
                </span>
                <span>{chapter.title}</span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

type ChapterPaginationProps = {
  chapter: Chapter;
  index: number;
  onNavigate: (id: string) => void;
};

function ChapterPagination({
  chapter,
  index,
  onNavigate,
}: ChapterPaginationProps) {
  const previous = chapters[index - 1];
  const next = chapters[index + 1];

  return (
    <nav
      className="chapter-pagination"
      aria-label={`“${chapter.title}”章节导航`}
    >
      {previous ? (
        <a
          className="chapter-pagination__link chapter-pagination__link--previous"
          href={`#${previous.id}`}
          onClick={() => onNavigate(previous.id)}
        >
          <span className="chapter-pagination__direction">← 上一章</span>
          <span className="chapter-pagination__title">{previous.title}</span>
        </a>
      ) : (
        <span
          className="chapter-pagination__link chapter-pagination__link--previous is-disabled"
          aria-disabled="true"
        >
          <span className="chapter-pagination__direction">← 上一章</span>
          <span className="chapter-pagination__title">已经是第一章</span>
        </span>
      )}

      {next ? (
        <a
          className="chapter-pagination__link chapter-pagination__link--next"
          href={`#${next.id}`}
          onClick={() => onNavigate(next.id)}
        >
          <span className="chapter-pagination__direction">下一章 →</span>
          <span className="chapter-pagination__title">{next.title}</span>
        </a>
      ) : (
        <span
          className="chapter-pagination__link chapter-pagination__link--next is-disabled"
          aria-disabled="true"
        >
          <span className="chapter-pagination__direction">下一章 →</span>
          <span className="chapter-pagination__title">已经读完本书</span>
        </span>
      )}
    </nav>
  );
}

export default function Reader() {
  const [activeChapterId, setActiveChapterId] = useState(
    () => chapters[0]?.id || "",
  );
  const [readingProgress, setReadingProgress] = useState(0);
  const [tocCollapsed, setTocCollapsed] = useState(false);
  const [mobileTocOpen, setMobileTocOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [theme, setTheme] = useState<Theme>("sepia");
  const [fontSize, setFontSize] = useState<FontSize>("medium");
  const [resumeMessage, setResumeMessage] = useState("");

  const activeChapterRef = useRef(activeChapterId);
  const themeRef = useRef(theme);
  const fontSizeRef = useRef(fontSize);
  const stateRestoredRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileTocTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);

  const activeIndex = useMemo(
    () => chapters.findIndex((chapter) => chapter.id === activeChapterId),
    [activeChapterId],
  );
  const activeChapter = activeIndex >= 0 ? chapters[activeIndex] : chapters[0];
  const coverPath = publicAssetPath(meta.cover);

  const searchResults = useMemo<SearchResult[]>(() => {
    const query = searchQuery.trim();
    if (!query) return [];

    const needle = query.toLocaleLowerCase("zh-CN");
    return chapters
      .map((chapter) => {
        const chapterTitle = chapter.title.toLocaleLowerCase("zh-CN");
        const chapterText = chapter.plainText.toLocaleLowerCase("zh-CN");
        const titleIndex = chapterTitle.indexOf(needle);
        const textIndex = chapterText.indexOf(needle);
        if (titleIndex < 0 && textIndex < 0) return null;

        return {
          chapter,
          snippet: makeSnippet(chapter.plainText, query),
          score:
            titleIndex === 0
              ? 0
              : titleIndex > 0
                ? 1
                : 2 + Math.max(0, textIndex) / 100_000,
        } satisfies SearchResult;
      })
      .filter((result): result is SearchResult => result !== null)
      .sort((left, right) => left.score - right.score);
  }, [searchQuery]);

  const closeSearch = useCallback((restoreFocus = true) => {
    setSearchOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => searchTriggerRef.current?.focus());
    }
  }, []);

  const closeMobileToc = useCallback((restoreFocus = true) => {
    setMobileTocOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => mobileTocTriggerRef.current?.focus());
    }
  }, []);

  const closeSettings = useCallback((restoreFocus = true) => {
    setSettingsOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => settingsTriggerRef.current?.focus());
    }
  }, []);

  const handleNavigate = useCallback((chapterId: string) => {
    setActiveChapterId(chapterId);
    setMobileTocOpen(false);
    setSearchOpen(false);
    setSettingsOpen(false);
  }, []);

  useEffect(() => {
    activeChapterRef.current = activeChapterId;
  }, [activeChapterId]);

  useEffect(() => {
    themeRef.current = theme;
    fontSizeRef.current = fontSize;

    if (stateRestoredRef.current) {
      writeStoredState({
        version: 1,
        chapterId: activeChapterRef.current,
        scrollY: window.scrollY,
        theme,
        fontSize,
        savedAt: Date.now(),
      });
    }
  }, [fontSize, theme]);

  useEffect(() => {
    let scrollFrame = 0;
    const restoreFrame = window.requestAnimationFrame(() => {
      const stored = readStoredState();
      if (stored) {
        setTheme(stored.theme);
        setFontSize(stored.fontSize);

        const savedChapter = chapters.find(
          (chapter) => chapter.id === stored.chapterId,
        );
        const decodedHash = currentHashId();
        const hashChapter = chapters.find(
          (chapter) => chapter.id === decodedHash,
        );

        if (hashChapter) {
          setActiveChapterId(hashChapter.id);
        } else if (savedChapter && stored.scrollY > 48) {
          setActiveChapterId(savedChapter.id);
          setResumeMessage(`已恢复至“${savedChapter.title}”`);
          scrollFrame = window.requestAnimationFrame(() => {
            window.scrollTo({ top: stored.scrollY, behavior: "auto" });
            stateRestoredRef.current = true;
          });
          return;
        }
      }

      stateRestoredRef.current = true;
    });

    return () => {
      window.cancelAnimationFrame(restoreFrame);
      window.cancelAnimationFrame(scrollFrame);
    };
  }, []);

  useEffect(() => {
    if (!resumeMessage) return;
    const timeout = window.setTimeout(() => setResumeMessage(""), 4200);
    return () => window.clearTimeout(timeout);
  }, [resumeMessage]);

  useEffect(() => {
    document.documentElement.dataset.readerTheme = theme;
    document.documentElement.dataset.readerFontSize = fontSize;

    return () => {
      delete document.documentElement.dataset.readerTheme;
      delete document.documentElement.dataset.readerFontSize;
    };
  }, [fontSize, theme]);

  useEffect(() => {
    const sectionElements = chapters
      .map((chapter) => document.getElementById(chapter.id))
      .filter((section): section is HTMLElement => Boolean(section));
    if (sectionElements.length === 0) return;

    const Observer = window.IntersectionObserver;
    if (typeof Observer === "undefined") {
      const updateActiveChapter = () => {
        const referenceY = window.innerHeight * 0.28;
        const closest = sectionElements
          .map((section) => ({
            section,
            distance: Math.abs(section.getBoundingClientRect().top - referenceY),
          }))
          .sort((left, right) => left.distance - right.distance)[0];
        if (closest) setActiveChapterId(closest.section.id);
      };
      window.addEventListener("scroll", updateActiveChapter, { passive: true });
      updateActiveChapter();
      return () => window.removeEventListener("scroll", updateActiveChapter);
    }

    const visible = new Map<string, IntersectionObserverEntry>();
    const observer = new Observer(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.set(entry.target.id, entry);
          else visible.delete(entry.target.id);
        }

        const closest = Array.from(visible.values()).sort(
          (left, right) =>
            Math.abs(left.boundingClientRect.top - window.innerHeight * 0.2) -
            Math.abs(right.boundingClientRect.top - window.innerHeight * 0.2),
        )[0];
        if (closest) setActiveChapterId(closest.target.id);
      },
      {
        rootMargin: "-16% 0px -68% 0px",
        threshold: [0, 0.01, 0.25],
      },
    );

    sectionElements.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let animationFrame = 0;
    let saveTimeout = 0;

    const persist = () => {
      if (!stateRestoredRef.current) return;
      const value: ReaderStorage = {
        version: 1,
        chapterId: activeChapterRef.current,
        scrollY: window.scrollY,
        theme: themeRef.current,
        fontSize: fontSizeRef.current,
        savedAt: Date.now(),
      };
      writeStoredState(value);
    };

    const updateProgress = () => {
      animationFrame = 0;
      const scrollable = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      const nextProgress = Math.min(
        100,
        Math.max(0, (window.scrollY / scrollable) * 100),
      );
      setReadingProgress(nextProgress);

      window.clearTimeout(saveTimeout);
      saveTimeout = window.setTimeout(persist, 280);
    };

    const scheduleProgressUpdate = () => {
      if (!animationFrame) {
        animationFrame = window.requestAnimationFrame(updateProgress);
      }
    };

    window.addEventListener("scroll", scheduleProgressUpdate, { passive: true });
    window.addEventListener("resize", scheduleProgressUpdate);
    window.addEventListener("beforeunload", persist);
    scheduleProgressUpdate();

    return () => {
      window.removeEventListener("scroll", scheduleProgressUpdate);
      window.removeEventListener("resize", scheduleProgressUpdate);
      window.removeEventListener("beforeunload", persist);
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(saveTimeout);
      persist();
    };
  }, []);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    const modalOpen = searchOpen || mobileTocOpen;
    if (!modalOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileTocOpen, searchOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (searchOpen) closeSearch();
        else if (mobileTocOpen) closeMobileToc();
        else if (settingsOpen) closeSettings();
        return;
      }

      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (event.key === "/" && !isTyping && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setMobileTocOpen(false);
        setSettingsOpen(false);
        setSearchOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    closeMobileToc,
    closeSearch,
    closeSettings,
    mobileTocOpen,
    searchOpen,
    settingsOpen,
  ]);

  return (
    <div
      className={`reader-shell reader-app theme-${theme} font-${fontSize}${
        tocCollapsed ? " is-toc-collapsed" : ""
      }`}
      data-theme={theme}
      data-font-size={fontSize}
    >
      <a className="skip-link" href="#reader-main">
        跳到正文
      </a>

      <div
        className="reading-progress"
        role="progressbar"
        aria-label="全书阅读进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(readingProgress)}
      >
        <span
          className="reading-progress__bar"
          style={{ transform: `scaleX(${readingProgress / 100})` }}
        />
      </div>

      <header className="reader-toolbar">
        <button
          className="reader-toolbar__button reader-toolbar__button--menu"
          type="button"
          ref={mobileTocTriggerRef}
          aria-expanded={mobileTocOpen}
          aria-controls="mobile-chapter-drawer"
          onClick={() => {
            setSearchOpen(false);
            setSettingsOpen(false);
            setMobileTocOpen(true);
          }}
        >
          <span aria-hidden="true">☰</span>
          <span>目录</span>
        </button>

        <a className="reader-toolbar__title" href="#book-start">
          {title}
        </a>
        <p className="reader-toolbar__chapter" aria-live="polite">
          {activeChapter?.title || "开始阅读"}
        </p>

        <div className="reader-toolbar__actions">
          <button
            className="reader-toolbar__button"
            type="button"
            ref={searchTriggerRef}
            aria-expanded={searchOpen}
            aria-controls="reader-search-dialog"
            onClick={() => {
              setMobileTocOpen(false);
              setSettingsOpen(false);
              setSearchOpen(true);
            }}
          >
            <span aria-hidden="true">⌕</span>
            <span>搜索</span>
            <kbd aria-hidden="true">/</kbd>
          </button>
          <button
            className="reader-toolbar__button"
            type="button"
            ref={settingsTriggerRef}
            aria-expanded={settingsOpen}
            aria-controls="reader-display-settings"
            onClick={() => {
              setSearchOpen(false);
              setMobileTocOpen(false);
              setSettingsOpen((open) => !open);
            }}
          >
            <span aria-hidden="true">Aa</span>
            <span>显示</span>
          </button>
        </div>

        {settingsOpen ? (
          <section
            className="display-settings"
            id="reader-display-settings"
            aria-label="阅读显示设置"
          >
            <div className="display-settings__header">
              <h2>阅读显示</h2>
              <button type="button" onClick={() => closeSettings()}>
                <span className="sr-only">关闭显示设置</span>
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <fieldset className="display-settings__group">
              <legend>页面主题</legend>
              <div className="segmented-control">
                {THEMES.map((option) => (
                  <button
                    className={theme === option.value ? "is-active" : undefined}
                    type="button"
                    key={option.value}
                    aria-pressed={theme === option.value}
                    onClick={() => setTheme(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="display-settings__group">
              <legend>正文字号</legend>
              <div className="segmented-control segmented-control--font-size">
                {FONT_SIZES.map((option) => (
                  <button
                    className={fontSize === option.value ? "is-active" : undefined}
                    type="button"
                    key={option.value}
                    aria-pressed={fontSize === option.value}
                    onClick={() => setFontSize(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>
          </section>
        ) : null}
      </header>

      <aside
        className={`reader-sidebar reader-toc reader-toc--desktop${
          tocCollapsed ? " is-collapsed" : ""
        }`}
        aria-label="章节目录"
      >
        <div className="reader-toc__header">
          {!tocCollapsed ? (
            <div>
              <p className="eyebrow">在线读本</p>
              <a className="reader-toc__book-title" href="#book-start">
                {title}
              </a>
            </div>
          ) : null}
          <button
            className="reader-toc__collapse"
            type="button"
            aria-expanded={!tocCollapsed}
            aria-label={tocCollapsed ? "展开目录" : "收起目录"}
            title={tocCollapsed ? "展开目录" : "收起目录"}
            onClick={() => setTocCollapsed((collapsed) => !collapsed)}
          >
            <span aria-hidden="true">{tocCollapsed ? "→" : "←"}</span>
          </button>
        </div>

        {!tocCollapsed ? (
          <>
            <TableOfContents
              activeId={activeChapterId}
              onNavigate={handleNavigate}
              variant="desktop"
            />
            <div className="reader-toc__footer">
              <p className="reader-toc__progress">
                <span>阅读进度</span>
                <strong>{Math.round(readingProgress)}%</strong>
              </p>
              <p className="study-note">{notice}</p>
            </div>
          </>
        ) : null}
      </aside>

      <main className="reader-content reader-main" id="reader-main">
        <section className="book-hero" id="book-start" aria-labelledby="book-title">
          <figure className="book-cover">
            {coverPath ? (
              // The cover is a static EPUB asset copied into the public directory.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverPath} alt={`《${title}》封面`} />
            ) : (
              <div className="cover-placeholder" aria-hidden="true">
                <span>MASTERING</span>
                <strong>YOUR PhD</strong>
                <i />
              </div>
            )}
          </figure>

          <div className="book-intro">
            <p className="eyebrow">
              在线读本{meta.year ? ` · ${meta.year}` : ""}
            </p>
            <h1 id="book-title">{title}</h1>
            <p className="subtitle">{subtitle}</p>
            {authors.length > 0 ? (
              <p className="authors">{authors.join(" · ")}</p>
            ) : null}
            {meta.publisher ? (
              <p className="book-publisher">{meta.publisher}</p>
            ) : null}
            {chapters[0] ? (
              <a
                className="primary-action"
                href={`#${chapters[0].id}`}
                onClick={() => handleNavigate(chapters[0].id)}
              >
                开始阅读 <span aria-hidden="true">→</span>
              </a>
            ) : null}
            <p className="book-intro__notice">{notice}</p>
          </div>
        </section>

        <div className="chapters" aria-label="书籍正文">
          {chapters.map((chapter, index) => (
            <article
              className={`reader-chapter${
                chapter.id === activeChapterId ? " is-current" : ""
              }`}
              id={chapter.id}
              key={chapter.id}
              data-chapter-index={index}
              aria-labelledby={`${chapter.id}-title`}
            >
              <header className="reader-chapter__header">
                <p className="chapter-number">
                  {chapterKicker(chapter, index)}
                </p>
                <h2 id={`${chapter.id}-title`}>{chapter.title}</h2>
              </header>

              <div
                className="chapter-body"
                // The extraction pipeline sanitizes this static HTML before it is
                // written to book-data; no user-supplied runtime HTML is accepted.
                dangerouslySetInnerHTML={{ __html: chapter.html }}
              />

              <ChapterPagination
                chapter={chapter}
                index={index}
                onNavigate={handleNavigate}
              />
            </article>
          ))}
        </div>

        <footer className="reader-footer">
          <p>{notice}</p>
          <p>
            本站用于个人学习和研究。作品版权归作者及出版方所有，网页内容按所获授权范围发布。
          </p>
          <a href="#book-start">返回书籍首页 ↑</a>
        </footer>
      </main>

      {mobileTocOpen ? (
        <div
          className="reader-overlay reader-overlay--toc"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeMobileToc();
          }}
        >
          <dialog
            open
            className="mobile-toc-drawer"
            id="mobile-chapter-drawer"
            aria-modal="true"
            aria-labelledby="mobile-toc-title"
            tabIndex={-1}
            onKeyDown={trapDialogFocus}
          >
            <header className="mobile-toc-drawer__header">
              <div>
                <p className="eyebrow">目录</p>
                <h2 id="mobile-toc-title">{title}</h2>
              </div>
              <button type="button" onClick={() => closeMobileToc()}>
                <span className="sr-only">关闭目录</span>
                <span aria-hidden="true">×</span>
              </button>
            </header>
            <TableOfContents
              activeId={activeChapterId}
              onNavigate={handleNavigate}
              variant="mobile"
            />
            <footer className="mobile-toc-drawer__footer">
              <p>
                已读 <strong>{Math.round(readingProgress)}%</strong>
              </p>
              <p>{notice}</p>
            </footer>
          </dialog>
        </div>
      ) : null}

      {searchOpen ? (
        <div
          className="reader-overlay reader-overlay--search"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeSearch();
          }}
        >
          <dialog
            open
            className="reader-search"
            id="reader-search-dialog"
            aria-modal="true"
            aria-labelledby="reader-search-title"
            tabIndex={-1}
            onKeyDown={trapDialogFocus}
          >
            <header className="reader-search__header">
              <div>
                <p className="eyebrow">全文检索</p>
                <h2 id="reader-search-title">搜索这本书</h2>
              </div>
              <button type="button" onClick={() => closeSearch()}>
                <span className="sr-only">关闭搜索</span>
                <span aria-hidden="true">×</span>
              </button>
            </header>

            <form
              className="reader-search__form"
              role="search"
              onSubmit={(event) => event.preventDefault()}
            >
              <label className="sr-only" htmlFor="book-search-input">
                输入章节标题或正文关键词
              </label>
              <span aria-hidden="true">⌕</span>
              <input
                id="book-search-input"
                ref={searchInputRef}
                type="search"
                value={searchQuery}
                placeholder="输入章节标题或正文关键词…"
                autoComplete="off"
                onChange={(event) => setSearchQuery(event.target.value)}
              />
              {searchQuery ? (
                <button
                  type="button"
                  className="reader-search__clear"
                  onClick={() => {
                    setSearchQuery("");
                    searchInputRef.current?.focus();
                  }}
                >
                  清除
                </button>
              ) : null}
            </form>

            <div
              className="reader-search__summary"
              role="status"
              aria-live="polite"
            >
              {searchQuery.trim()
                ? `找到 ${searchResults.length} 个相关章节`
                : "可搜索章节标题和全部正文"}
            </div>

            <div className="reader-search__results">
              {searchQuery.trim() && searchResults.length === 0 ? (
                <div className="reader-search__empty">
                  <p>没有找到“{searchQuery.trim()}”</p>
                  <p>试试缩短关键词，或使用不同的表达。</p>
                </div>
              ) : null}

              {searchResults.length > 0 ? (
                <ol>
                  {searchResults.map(({ chapter, snippet }) => {
                    const chapterIndex = chapters.findIndex(
                      (item) => item.id === chapter.id,
                    );
                    return (
                      <li key={chapter.id}>
                        <a
                          className="reader-search__result"
                          href={`#${chapter.id}`}
                          onClick={() => handleNavigate(chapter.id)}
                        >
                          <span className="reader-search__result-number">
                            {chapterKicker(chapter, chapterIndex)}
                          </span>
                          <h3>{markMatch(chapter.title, searchQuery)}</h3>
                          <p>{markMatch(snippet, searchQuery)}</p>
                        </a>
                      </li>
                    );
                  })}
                </ol>
              ) : null}
            </div>

            <footer className="reader-search__footer">
              <span>
                按 <kbd>Esc</kbd> 关闭
              </span>
            </footer>
          </dialog>
        </div>
      ) : null}

      {resumeMessage ? (
        <div className="reader-toast" role="status" aria-live="polite">
          <span aria-hidden="true">✓</span>
          {resumeMessage}
        </div>
      ) : null}
    </div>
  );
}
