#!/usr/bin/env python3
"""Extract a sanitized, ordered book data module from an EPUB file.

The script follows the package spine, copies image resources, keeps the
semantic markup inside each XHTML body, and emits TypeScript data for the
reader UI. It intentionally excludes a redundant cover document and the EPUB
navigation document; the cover image itself is still extracted.
"""

from __future__ import annotations

import argparse
import json
import posixpath
import re
import sys
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit
from zipfile import BadZipFile, ZipFile
import xml.etree.ElementTree as ET


CONTAINER_PATH = "META-INF/container.xml"
CONTAINER_NS = "urn:oasis:names:tc:opendocument:xmlns:container"
OPF_NS = "http://www.idpf.org/2007/opf"
DC_NS = "http://purl.org/dc/elements/1.1/"
XML_NS = "http://www.w3.org/XML/1998/namespace"
EPUB_NS = "http://www.idpf.org/2007/ops"

BLOCKED_ELEMENTS = {
    "applet",
    "base",
    "button",
    "embed",
    "form",
    "iframe",
    "input",
    "link",
    "meta",
    "object",
    "option",
    "script",
    "select",
    "style",
    "template",
    "textarea",
}
BLOCK_ELEMENTS = {
    "address",
    "article",
    "aside",
    "blockquote",
    "br",
    "div",
    "figcaption",
    "figure",
    "footer",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "hr",
    "li",
    "main",
    "nav",
    "ol",
    "p",
    "pre",
    "section",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "tr",
    "ul",
}
URL_ATTRIBUTES = {"href", "poster", "src"}
DROP_ATTRIBUTES = {"action", "formaction", "srcdoc", "srcset", "style"}
ARIA_IDREF_ATTRIBUTES = {"aria-controls", "aria-describedby", "aria-labelledby"}
SAFE_URL_SCHEMES = {"", "http", "https", "mailto", "tel"}
SKIP_SPINE_IDS = {"cover", "nav"}


@dataclass(frozen=True)
class ManifestItem:
    item_id: str
    href: str
    media_type: str
    properties: frozenset[str]


def local_name(name: str) -> str:
    """Return the local component of an ElementTree qualified name."""
    return name.rsplit("}", 1)[-1] if "}" in name else name


def namespace(name: str) -> str:
    """Return the namespace URI of an ElementTree qualified name."""
    return name[1:].split("}", 1)[0] if name.startswith("{") else ""


def zip_path(base: str, href: str) -> str:
    """Resolve an EPUB-relative path without allowing it to escape the ZIP."""
    decoded = unquote(urlsplit(href).path)
    resolved = posixpath.normpath(posixpath.join(base, decoded))
    if resolved == ".." or resolved.startswith("../") or resolved.startswith("/"):
        raise ValueError(f"Unsafe path in EPUB: {href!r}")
    return resolved


def read_xml(archive: ZipFile, member: str) -> ET.Element:
    try:
        return ET.fromstring(archive.read(member))
    except KeyError as exc:
        raise ValueError(f"EPUB member is missing: {member}") from exc
    except ET.ParseError as exc:
        raise ValueError(f"Invalid XML in EPUB member {member}: {exc}") from exc


def discover_package_path(archive: ZipFile) -> str:
    container = read_xml(archive, CONTAINER_PATH)
    rootfile = container.find(f".//{{{CONTAINER_NS}}}rootfile")
    if rootfile is None or not rootfile.get("full-path"):
        raise ValueError("EPUB container does not declare an OPF rootfile")
    package_path = posixpath.normpath(rootfile.get("full-path", ""))
    if package_path.startswith("../") or package_path.startswith("/"):
        raise ValueError("EPUB container declares an unsafe OPF path")
    return package_path


def text_content(element: ET.Element | None) -> str:
    if element is None:
        return ""
    return re.sub(r"\s+", " ", "".join(element.itertext())).strip()


def metadata_values(package: ET.Element, element_name: str) -> list[str]:
    return [
        value
        for node in package.findall(f".//{{{DC_NS}}}{element_name}")
        if (value := text_content(node))
    ]


def make_safe_filename(href: str, used: set[str], item_id: str) -> str:
    raw_name = PurePosixPath(unquote(urlsplit(href).path)).name
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", raw_name).strip(".-")
    if not name:
        name = re.sub(r"[^A-Za-z0-9_-]+", "-", item_id).strip("-") or "image"
    candidate = name
    if candidate.casefold() in used:
        stem = Path(name).stem
        suffix = Path(name).suffix
        prefix = re.sub(r"[^A-Za-z0-9_-]+", "-", item_id).strip("-") or "image"
        candidate = f"{prefix}-{stem}{suffix}"
        serial = 2
        while candidate.casefold() in used:
            candidate = f"{prefix}-{stem}-{serial}{suffix}"
            serial += 1
    used.add(candidate.casefold())
    return candidate


def safe_url(value: str) -> bool:
    compact = re.sub(r"[\x00-\x20]+", "", value).lower()
    if compact.startswith(("javascript:", "vbscript:", "data:")):
        return False
    return urlsplit(value).scheme.lower() in SAFE_URL_SCHEMES


def normalize_attribute_name(name: str) -> str | None:
    attr_namespace = namespace(name)
    attr_name = local_name(name).lower()
    if attr_namespace == EPUB_NS and attr_name == "type":
        return "data-epub-type"
    if attr_namespace == XML_NS and attr_name == "lang":
        return "lang"
    if attr_namespace and attr_namespace not in {EPUB_NS, XML_NS}:
        return None
    return attr_name


def rewrite_image_url(
    value: str,
    document_path: str,
    image_outputs: dict[str, str],
) -> str | None:
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc:
        return value if safe_url(value) else None
    resolved = posixpath.normpath(
        posixpath.join(posixpath.dirname(document_path), unquote(parsed.path))
    )
    filename = image_outputs.get(resolved)
    if filename is None:
        return value if safe_url(value) else None
    suffix = f"#{parsed.fragment}" if parsed.fragment else ""
    return f"book/images/{filename}{suffix}"


def sanitize_element(
    element: ET.Element,
    *,
    chapter_id: str,
    document_path: str,
    image_outputs: dict[str, str],
) -> None:
    element.tag = local_name(element.tag).lower()
    cleaned_attributes: dict[str, str] = {}
    for raw_name, raw_value in element.attrib.items():
        name = normalize_attribute_name(raw_name)
        if name is None or name in DROP_ATTRIBUTES or name.startswith("on"):
            continue
        value = raw_value.strip()
        if name == "id":
            value = f"{chapter_id}-{value}"
        elif name in ARIA_IDREF_ATTRIBUTES:
            value = " ".join(f"{chapter_id}-{token}" for token in value.split())
        elif name == "href" and value.startswith("#"):
            fragment = value[1:]
            value = f"#{chapter_id}-{fragment}" if fragment else "#"
        elif name == "src" and element.tag == "img":
            rewritten = rewrite_image_url(value, document_path, image_outputs)
            if rewritten is None:
                continue
            value = rewritten
        elif name in URL_ATTRIBUTES and not safe_url(value):
            continue
        cleaned_attributes[name] = value
    element.attrib.clear()
    element.attrib.update(cleaned_attributes)

    for child in list(element):
        if local_name(child.tag).lower() in BLOCKED_ELEMENTS:
            element.remove(child)
            continue
        sanitize_element(
            child,
            chapter_id=chapter_id,
            document_path=document_path,
            image_outputs=image_outputs,
        )


def body_plain_text(body: ET.Element) -> str:
    parts: list[str] = []

    def walk(node: ET.Element) -> None:
        if node.text:
            parts.append(node.text)
        for child in node:
            walk(child)
            if local_name(child.tag) in BLOCK_ELEMENTS:
                parts.append("\n")
            if child.tail:
                parts.append(child.tail)

    walk(body)
    value = "".join(parts).replace("\u00a0", " ")
    value = re.sub(r"[ \t\f\v]+", " ", value)
    value = re.sub(r" *\n *", "\n", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def body_html(body: ET.Element) -> str:
    return "".join(
        ET.tostring(child, encoding="unicode", method="xml") for child in body
    ).strip()


def find_first(root: ET.Element, name: str) -> ET.Element | None:
    return root.find(f".//{{*}}{name}")


def extract_title_page(archive: ZipFile, document_path: str) -> tuple[str, str]:
    root = read_xml(archive, document_path)
    body = find_first(root, "body")
    if body is None:
        return "", ""
    title = ""
    subtitle = ""
    for element in body.iter():
        if local_name(element.tag).lower() == "h1" and not title:
            title = text_content(element)
        classes = element.get("class", "").split()
        if "subtitle" in classes and not subtitle:
            subtitle = text_content(element)
    return title, subtitle


def chapter_from_xhtml(
    archive: ZipFile,
    item: ManifestItem,
    package_dir: str,
    image_outputs: dict[str, str],
) -> dict[str, str]:
    document_path = zip_path(package_dir, item.href)
    root = read_xml(archive, document_path)
    title_element = find_first(root, "title")
    body = find_first(root, "body")
    if body is None:
        raise ValueError(f"XHTML spine item has no body: {document_path}")

    chapter_id = re.sub(r"[^A-Za-z0-9_-]+", "-", item.item_id).strip("-")
    if not chapter_id:
        raise ValueError(f"Spine item has an unusable ID: {item.item_id!r}")
    sanitize_element(
        body,
        chapter_id=chapter_id,
        document_path=document_path,
        image_outputs=image_outputs,
    )
    heading = next(
        (node for node in body.iter() if local_name(node.tag) in {"h1", "h2"}),
        None,
    )
    title = text_content(title_element) or text_content(heading) or chapter_id
    return {
        "id": chapter_id,
        "title": title,
        "html": body_html(body),
        "plainText": body_plain_text(body),
    }


def typescript_module(book_meta: dict[str, object], chapters: list[dict[str, str]]) -> str:
    meta_json = json.dumps(book_meta, ensure_ascii=False, indent=2)
    chapters_json = json.dumps(chapters, ensure_ascii=False, indent=2)
    return f'''// Generated by scripts/extract_epub.py. Do not edit by hand.

export type BookMeta = {{
  title: string;
  subtitle: string;
  authors: string[];
  publisher: string;
  year: string;
  notice: string;
  cover: string;
}};

export type Chapter = {{
  id: string;
  title: string;
  html: string;
  plainText: string;
}};

export const bookMeta: BookMeta = {meta_json};

export const chapters: Chapter[] = {chapters_json};
'''


def validate_output(
    chapters: list[dict[str, str]],
    image_dir: Path,
    expected_image_names: set[str],
) -> dict[str, int]:
    chapter_ids = [chapter["id"] for chapter in chapters]
    if len(chapter_ids) != len(set(chapter_ids)):
        raise ValueError("Generated chapter IDs are not unique")

    html_ids: set[str] = set()
    fragment_references: set[str] = set()
    image_references: set[str] = set()
    heading_count = 0
    for chapter in chapters:
        chapter_id = chapter["id"]
        html = chapter["html"]
        if re.search(r"<(?:script|style)\b", html, flags=re.IGNORECASE):
            raise ValueError(f"Unsafe element survived sanitization in {chapter_id}")
        if re.search(r"\s(?:on[a-z]+|style)\s*=", html, flags=re.IGNORECASE):
            raise ValueError(f"Unsafe attribute survived sanitization in {chapter_id}")
        if not chapter["plainText"]:
            raise ValueError(f"Chapter has no searchable text: {chapter_id}")

        root = ET.fromstring(f"<article>{html}</article>")
        for node in root.iter():
            node_id = node.get("id")
            if node_id:
                if not node_id.startswith(f"{chapter_id}-"):
                    raise ValueError(f"Unprefixed element ID in {chapter_id}: {node_id}")
                if node_id in html_ids:
                    raise ValueError(f"Duplicate generated element ID: {node_id}")
                html_ids.add(node_id)
            if local_name(node.tag) in {"h1", "h2", "h3", "h4", "h5", "h6"}:
                heading_count += 1
            href = node.get("href", "")
            if href.startswith("#") and len(href) > 1:
                fragment_references.add(href[1:])
            if local_name(node.tag) == "img" and node.get("src"):
                src = node.get("src", "")
                if src.startswith("book/images/"):
                    image_references.add(src.removeprefix("book/images/").split("#", 1)[0])

    missing_files = {
        name for name in expected_image_names if not (image_dir / name).is_file()
    }
    if missing_files:
        raise ValueError(f"Extracted images are missing: {sorted(missing_files)}")
    missing_references = {
        name for name in image_references if not (image_dir / name).is_file()
    }
    if missing_references:
        raise ValueError(f"HTML references missing images: {sorted(missing_references)}")
    missing_fragments = fragment_references - html_ids
    if missing_fragments:
        raise ValueError(f"HTML references missing fragments: {sorted(missing_fragments)}")

    return {
        "chapters": len(chapters),
        "headings": heading_count,
        "htmlIds": len(html_ids),
        "imagesExtracted": len(expected_image_names),
        "imagesReferenced": len(image_references),
    }


def extract(args: argparse.Namespace) -> dict[str, object]:
    epub_path = args.epub.resolve()
    data_path = args.data.resolve()
    image_dir = args.images.resolve()
    if not epub_path.is_file():
        raise ValueError(f"EPUB does not exist: {epub_path}")

    try:
        archive = ZipFile(epub_path)
    except BadZipFile as exc:
        raise ValueError(f"Not a valid EPUB/ZIP file: {epub_path}") from exc

    with archive:
        package_path = discover_package_path(archive)
        package_dir = posixpath.dirname(package_path)
        package = read_xml(archive, package_path)
        ns = {"opf": OPF_NS}

        manifest: dict[str, ManifestItem] = {}
        for node in package.findall("opf:manifest/opf:item", ns):
            item_id = node.get("id", "").strip()
            href = node.get("href", "").strip()
            if not item_id or not href:
                continue
            manifest[item_id] = ManifestItem(
                item_id=item_id,
                href=href,
                media_type=node.get("media-type", "").strip(),
                properties=frozenset(node.get("properties", "").split()),
            )

        image_dir.mkdir(parents=True, exist_ok=True)
        used_names: set[str] = set()
        image_outputs: dict[str, str] = {}
        for item in manifest.values():
            if not item.media_type.startswith("image/"):
                continue
            source = zip_path(package_dir, item.href)
            filename = make_safe_filename(item.href, used_names, item.item_id)
            try:
                image_bytes = archive.read(source)
            except KeyError as exc:
                raise ValueError(f"Manifest image is missing: {source}") from exc
            (image_dir / filename).write_bytes(image_bytes)
            image_outputs[source] = filename

        spine_items: list[ManifestItem] = []
        for itemref in package.findall("opf:spine/opf:itemref", ns):
            item_id = itemref.get("idref", "").strip()
            item = manifest.get(item_id)
            if item is None:
                raise ValueError(f"Spine references unknown manifest item: {item_id}")
            if item.item_id in SKIP_SPINE_IDS or "nav" in item.properties:
                continue
            if item.media_type != "application/xhtml+xml":
                continue
            spine_items.append(item)

        chapters = [
            chapter_from_xhtml(archive, item, package_dir, image_outputs)
            for item in spine_items
        ]
        if not chapters:
            raise ValueError("No readable XHTML documents found in the EPUB spine")

        title = (metadata_values(package, "title") or [chapters[0]["title"]])[0]
        authors = metadata_values(package, "creator")
        publisher = (metadata_values(package, "publisher") or [""])[0]
        date = (metadata_values(package, "date") or [""])[0]
        year_match = re.search(r"\b(?:19|20)\d{2}\b", date)
        title_item = manifest.get("title")
        subtitle = ""
        if title_item is not None:
            title_page_title, subtitle = extract_title_page(
                archive,
                zip_path(package_dir, title_item.href),
            )
            title = title_page_title or title
        book_meta: dict[str, object] = {
            "title": title,
            "subtitle": subtitle,
            "authors": authors,
            "publisher": publisher,
            "year": year_match.group(0) if year_match else date,
            "notice": args.notice,
            "cover": "book/images/cover.png",
        }

    data_path.parent.mkdir(parents=True, exist_ok=True)
    data_path.write_text(
        typescript_module(book_meta, chapters),
        encoding="utf-8",
    )
    validation = validate_output(chapters, image_dir, set(image_outputs.values()))
    return {
        "epub": str(epub_path),
        "data": str(data_path),
        "dataBytes": data_path.stat().st_size,
        "imageDirectory": str(image_dir),
        "imageBytes": sum(path.stat().st_size for path in image_dir.iterdir() if path.is_file()),
        **validation,
        "chapterIds": [chapter["id"] for chapter in chapters],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("epub", type=Path, help="Path to the source EPUB")
    parser.add_argument(
        "--data",
        type=Path,
        default=Path("app/book-data.ts"),
        help="Generated TypeScript module (default: app/book-data.ts)",
    )
    parser.add_argument(
        "--images",
        type=Path,
        default=Path("public/book/images"),
        help="Extracted image directory (default: public/book/images)",
    )
    parser.add_argument(
        "--notice",
        default="经权利人授权发布，仅供个人学习与研究。",
        help="Reader notice included in the generated metadata",
    )
    return parser.parse_args()


def main() -> int:
    try:
        summary = extract(parse_args())
    except (OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
