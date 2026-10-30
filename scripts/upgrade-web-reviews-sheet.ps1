param(
  [Parameter(Mandatory = $true)][string]$WorkbookPath,
  [Parameter(Mandatory = $true)][string]$EnrichedCsvPath
)

$ErrorActionPreference = 'Stop'
$excel = $null
$workbook = $null
$sourceWorkbook = $null
$worksheet = $null
$sourceSheet = $null
$reviewTable = $null

function Write-Result([hashtable]$Value) {
  [Console]::Out.Write(($Value | ConvertTo-Json -Compress -Depth 5))
}

try {
  if (-not (Test-Path -LiteralPath $WorkbookPath -PathType Leaf)) { throw "Excel file not found: $WorkbookPath" }
  if (-not (Test-Path -LiteralPath $EnrichedCsvPath -PathType Leaf)) { throw "Enriched CSV not found: $EnrichedCsvPath" }

  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.ScreenUpdating = $false
  $excel.EnableEvents = $false
  $workbook = $excel.Workbooks.Open((Resolve-Path -LiteralPath $WorkbookPath).Path, 0, $false)
  if ($workbook.ReadOnly) { throw 'Workbook is read-only or locked' }
  $worksheet = $workbook.Worksheets.Item('web_reviews')
  if ([string]$worksheet.Range('A1').Value2 -ne 'listing_id' -or [string]$worksheet.Range('B1').Value2 -ne 'date') {
    throw 'web_reviews headers A1:B1 are not listing_id,date'
  }
  if ([string]$worksheet.Range('C1').Value2 -eq 'rating') {
    throw 'web_reviews already contains the requested mock/web review columns'
  }

  $rawLastRow = $worksheet.Cells.Item($worksheet.Rows.Count, 1).End(-4162).Row
  $kpiHeaderBefore = [string]$worksheet.Range('D1').Value2
  $tableCountBefore = $worksheet.ListObjects.Count

  $excel.Workbooks.OpenText(
    (Resolve-Path -LiteralPath $EnrichedCsvPath).Path,
    65001,
    1,
    1,
    1,
    $false,
    $false,
    $false,
    $false,
    $true
  )
  $sourceWorkbook = $excel.ActiveWorkbook
  $sourceSheet = $sourceWorkbook.Worksheets.Item(1)
  $sourceLastRow = $sourceSheet.Cells.Item($sourceSheet.Rows.Count, 1).End(-4162).Row
  if ($sourceLastRow -ne $rawLastRow) {
    throw "Enriched CSV row count $sourceLastRow does not match web_reviews row count $rawLastRow"
  }

  $workbook.Activate()
  $worksheet.Activate()
  $worksheet.Columns('C:G').Insert(-4161)
  $sourceSheet.Range("C1:G${sourceLastRow}").Copy()
  [void]$worksheet.Range('C1').PasteSpecial(-4163)
  $excel.CutCopyMode = 0

  foreach ($candidate in $worksheet.ListObjects) {
    $firstHeader = [string]$candidate.HeaderRowRange.Cells.Item(1, 1).Value2
    $secondHeader = if ($candidate.ListColumns.Count -ge 2) { [string]$candidate.HeaderRowRange.Cells.Item(1, 2).Value2 } else { '' }
    if ($firstHeader -eq 'listing_id' -and $secondHeader -eq 'date') { $reviewTable = $candidate; break }
  }
  if ($null -eq $reviewTable) {
    $reviewTable = $worksheet.ListObjects.Add(1, $worksheet.Range("A1:G${rawLastRow}"), $null, 1)
    $reviewTable.Name = 'tblWebReviews'
    $reviewTable.TableStyle = 'TableStyleMedium2'
  } else {
    $reviewTable.Resize($worksheet.Range("A1:G${rawLastRow}"))
  }

  $worksheet.Columns.Item('A').NumberFormat = '@'
  $worksheet.Columns.Item('B').NumberFormat = 'yyyy-mm-dd'
  $worksheet.Columns.Item('C').NumberFormat = '0'
  $worksheet.Columns.Item('D').ColumnWidth = 58
  $worksheet.Columns.Item('D').WrapText = $false
  $worksheet.Columns.Item('E').ColumnWidth = 22
  $worksheet.Columns.Item('F').NumberFormat = 'yyyy-mm-dd hh:mm'
  $worksheet.Columns.Item('F').ColumnWidth = 19
  $worksheet.Columns.Item('G').ColumnWidth = 13
  $worksheet.Range('A2').Select() | Out-Null

  $workbook.Save()
  $kpiHeaderAfter = [string]$worksheet.Range('I1').Value2
  Write-Result @{
    ok = $true
    sheet_name = 'web_reviews'
    table_name = $reviewTable.Name
    rows_enriched = $rawLastRow - 1
    headers = @('listing_id', 'date', 'rating', 'comment', 'reviewer_masked', 'created_at', 'data_source')
    kpi_header_before = $kpiHeaderBefore
    kpi_header_after = $kpiHeaderAfter
    table_count_before = $tableCountBefore
    table_count_after = $worksheet.ListObjects.Count
  }
} catch {
  Write-Result @{ ok = $false; message = $_.Exception.Message }
  exit 1
} finally {
  if ($null -ne $sourceWorkbook) { try { $sourceWorkbook.Close($false) } catch {} }
  if ($null -ne $workbook) { try { $workbook.Close($false) } catch {} }
  if ($null -ne $excel) { try { $excel.Quit() } catch {} }
  foreach ($item in @($reviewTable, $sourceSheet, $worksheet, $sourceWorkbook, $workbook, $excel)) {
    if ($null -ne $item -and [Runtime.InteropServices.Marshal]::IsComObject($item)) {
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($item)
    }
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
