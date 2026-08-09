import sys
from docx import Document
from docx.document import Document as _Doc
from docx.oxml.table import CT_Tbl
from docx.oxml.text.paragraph import CT_P
from docx.table import Table
from docx.text.paragraph import Paragraph

def iter_block_items(parent):
    if isinstance(parent, _Doc):
        parent_elm = parent.element.body
    else:
        parent_elm = parent._tc
    for child in parent_elm.iterchildren():
        if isinstance(child, CT_P):
            yield Paragraph(child, parent)
        elif isinstance(child, CT_Tbl):
            yield Table(child, parent)

def dump(path):
    doc = Document(path)
    out = []
    for block in iter_block_items(doc):
        if isinstance(block, Paragraph):
            txt = block.text.strip()
            style = block.style.name if block.style else ''
            if txt:
                if style and ('Heading' in style or 'Title' in style):
                    out.append(f"\n## [{style}] {txt}")
                else:
                    out.append(txt)
        elif isinstance(block, Table):
            out.append("\n[TABLE]")
            for row in block.rows:
                cells = [c.text.strip().replace('\n', ' / ') for c in row.cells]
                out.append(" | ".join(cells))
            out.append("[/TABLE]\n")
    return "\n".join(out)

if __name__ == "__main__":
    text = dump(sys.argv[1])
    outpath = sys.argv[2] if len(sys.argv) > 2 else sys.argv[1] + ".txt"
    with open(outpath, "w", encoding="utf-8") as f:
        f.write(text)
    print("Wrote", outpath, len(text), "chars")
