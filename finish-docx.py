#!/usr/bin/env python3
# 转换后的收尾：给「目录」「0. 文档说明」两段加段前分页，并统一表格内字号
import sys
from docx import Document
from docx.shared import Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH

PATH = "/Users/ghost/WorkBuddy/2026-11-09-16-58-52/拉了么-产品文档.docx"

doc = Document(PATH)

breaks = {"目\u3000录", "目 录", "0. 文档说明"}
hit = set()
for p in doc.paragraphs:
    t = p.text.strip()
    if t in breaks and t not in hit:
        p.paragraph_format.page_break_before = True
        hit.add(t)

# 表格：正文段落统一 9pt，表头加粗已由 HTML 决定
for table in doc.tables:
    for row in table.rows:
        for cell in row.cells:
            for p in cell.paragraphs:
                p.paragraph_format.space_before = Pt(2)
                p.paragraph_format.space_after = Pt(2)
                for run in p.runs:
                    if run.font.size is None:
                        run.font.size = Pt(9)

# 代码块（等宽段落）收紧行距，避免每行像独立段落
for p in doc.paragraphs:
    names = {r.font.name for r in p.runs if r.font.name}
    if names and names.issubset({"Courier New"}):
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(0)
        p.paragraph_format.line_spacing = 1.2

doc.save(PATH)
print("post-processed; breaks:", sorted(hit))
