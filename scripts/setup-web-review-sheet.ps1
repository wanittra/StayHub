param(
  [Parameter(Mandatory = $true)][string]$WorkbookPath,
  [Parameter(Mandatory = $true)][string]$SeedCsvPath
)

$ErrorActionPreference = 'Stop'
$excel = $null
$workbook = $null
$worksheet = $null
$table = $null
$rawSheet = $null

function Write-Result([hashtable]$Value) {
  [Console]::Out.Write(($Value | ConvertTo-Json -Compress -Depth 5))
}

try {
  if (-not (Test-Path -LiteralPath $WorkbookPath -PathType Leaf)) { throw "Excel file not found: $WorkbookPath" }
  if (-not (Test-Path -LiteralPath $SeedCsvPath -PathType Leaf)) { throw "Seed CSV not found: $SeedCsvPath" }
  $rows = @(Import-Csv -LiteralPath $SeedCsvPath -Encoding UTF8)
  $headers = @('review_id', 'request_id', 'listing_id', 'reviewer_masked', 'rating', 'comment', 'created_at', 'data_source', 'is_mock')

  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.ScreenUpdating = $false
  $excel.EnableEvents = $false
  $excel.Calculation = -4135
  $workbook = $excel.Workbooks.Open($WorkbookPath, 0, $false)
  if ($workbook.ReadOnly) { throw 'Workbook is read-only or locked' }

  $rawSheet = $workbook.Worksheets.Item('web_reviews')
  $rawRowsBefore = $rawSheet.UsedRange.Rows.Count
  foreach ($candidate in $workbook.Worksheets) {
    if ([string]$candidate.Name -eq 'web_review') { throw 'Sheet web_review already exists; setup stopped to protect existing website reviews' }
  }

  $worksheet = $workbook.Worksheets.Add($null, $workbook.Worksheets.Item($workbook.Worksheets.Count))
  $worksheet.Name = 'web_review'
  for ($column = 0; $column -lt $headers.Count; $column++) {
    $worksheet.Cells.Item(1, $column + 1).Value2 = $headers[$column]
  }

  $batchSize = 2000
  for ($offset = 0; $offset -lt $rows.Count; $offset += $batchSize) {
    $count = [Math]::Min($batchSize, $rows.Count - $offset)
    $values = New-Object 'object[,]' $count, $headers.Count
    for ($rowIndex = 0; $rowIndex -lt $count; $rowIndex++) {
      $row = $rows[$offset + $rowIndex]
      $values[$rowIndex, 0] = [string]$row.review_id
      $values[$rowIndex, 1] = [string]$row.request_id
      $values[$rowIndex, 2] = [string]$row.listing_id
      $values[$rowIndex, 3] = [string]$row.reviewer_masked
      $values[$rowIndex, 4] = [int]$row.rating
      $values[$rowIndex, 5] = [string]$row.comment
      $timestamp = [DateTimeOffset]::Parse([string]$row.created_at, [Globalization.CultureInfo]::InvariantCulture)
      $values[$rowIndex, 6] = $timestamp.DateTime.ToOADate()
      $values[$rowIndex, 7] = [string]$row.data_source
      $values[$rowIndex, 8] = [string]$row.is_mock -eq 'TRUE'
    }
    $startRow = $offset + 2
    $endRow = $startRow + $count - 1
    $worksheet.Range("A${startRow}:I${endRow}").Value2 = $values
  }

  $lastRow = $rows.Count + 1
  $tableRange = $worksheet.Range("A1:I${lastRow}")
  $table = $worksheet.ListObjects.Add(1, $tableRange, $null, 1)
  $table.Name = 'tblWebReview'
  $table.TableStyle = 'TableStyleMedium2'
  $worksheet.Columns.Item('A').ColumnWidth = 27
  $worksheet.Columns.Item('B').ColumnWidth = 30
  $worksheet.Columns.Item('C').ColumnWidth = 19
  $worksheet.Columns.Item('D').ColumnWidth = 22
  $worksheet.Columns.Item('E').ColumnWidth = 9
  $worksheet.Columns.Item('F').ColumnWidth = 58
  $worksheet.Columns.Item('G').ColumnWidth = 20
  $worksheet.Columns.Item('H').ColumnWidth = 18
  $worksheet.Columns.Item('I').ColumnWidth = 10
  $worksheet.Columns.Item('C').NumberFormat = '@'
  $worksheet.Columns.Item('E').NumberFormat = '0'
  $worksheet.Columns.Item('G').NumberFormat = 'yyyy-mm-dd hh:mm'
  $worksheet.Columns.Item('I').NumberFormat = 'General'
  $worksheet.Rows.Item(1).RowHeight = 24
  $worksheet.Activate()
  $excel.ActiveWindow.SplitRow = 1
  $excel.ActiveWindow.FreezePanes = $true
  $worksheet.Range('A2').Select() | Out-Null

  $workbook.Save()
  $rawRowsAfter = $rawSheet.UsedRange.Rows.Count
  Write-Result @{
    ok = $true
    sheet_name = 'web_review'
    table_name = 'tblWebReview'
    rows_written = $rows.Count
    raw_web_reviews_rows_before = $rawRowsBefore
    raw_web_reviews_rows_after = $rawRowsAfter
  }
} catch {
  Write-Result @{ ok = $false; message = $_.Exception.Message }
  exit 1
} finally {
  if ($null -ne $workbook) { try { $workbook.Close($false) } catch {} }
  if ($null -ne $excel) { try { $excel.Quit() } catch {} }
  foreach ($item in @($table, $worksheet, $rawSheet, $workbook, $excel)) {
    if ($null -ne $item -and [Runtime.InteropServices.Marshal]::IsComObject($item)) {
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($item)
    }
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
