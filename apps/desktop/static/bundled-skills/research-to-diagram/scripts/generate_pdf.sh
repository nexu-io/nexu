#!/bin/bash
# Generate PDF from DOT file using Graphviz

set -e

# 显示用法
usage() {
    cat << EOF
Usage: $0 <input.dot> [output.pdf]

Generate PDF from Graphviz DOT file.

Arguments:
  input.dot    Input DOT file path (required)
  output.pdf   Output PDF file path (optional, defaults to same name as input)

Examples:
  $0 diagram.dot
  $0 diagram.dot output.pdf

Requirements:
  - Graphviz must be installed (brew install graphviz)
EOF
    exit 1
}

# 检查参数
if [ $# -lt 1 ]; then
    echo "Error: Missing input file"
    usage
fi

INPUT_DOT="$1"
OUTPUT_PDF="${2:-${INPUT_DOT%.dot}.pdf}"

# 检查输入文件是否存在
if [ ! -f "$INPUT_DOT" ]; then
    echo "Error: Input file '$INPUT_DOT' not found"
    exit 1
fi

# 检查 Graphviz 是否安装
if ! command -v dot &> /dev/null; then
    echo "Error: Graphviz is not installed"
    echo "Install with: brew install graphviz"
    exit 1
fi

# 验证 DOT 文件语法
echo "Validating DOT file syntax..."
if ! dot -Tpdf "$INPUT_DOT" -o /dev/null 2>&1; then
    echo "Error: Invalid DOT file syntax"
    exit 1
fi

# 生成 PDF
echo "Generating PDF: $OUTPUT_PDF"
dot -Tpdf "$INPUT_DOT" -o "$OUTPUT_PDF"

# 检查生成是否成功
if [ -f "$OUTPUT_PDF" ]; then
    FILE_SIZE=$(du -h "$OUTPUT_PDF" | cut -f1)
    echo "✓ PDF generated successfully: $OUTPUT_PDF ($FILE_SIZE)"
else
    echo "✗ Failed to generate PDF"
    exit 1
fi
