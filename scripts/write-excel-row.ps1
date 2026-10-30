param(
  [Parameter(Mandatory = $true)][string]$WorkbookPath,
  [Parameter(Mandatory = $true)][string]$SheetName
)

$ErrorActionPreference = 'Stop'
$excel = $null
$workbook = $null
$worksheet = $null
$table = $null
$rowRange = $null
$calculationRange = $null

function Write-Result([hashtable]$Value) {
  [Console]::Out.Write(($Value | ConvertTo-Json -Compress -Depth 5))
}

try {
  if (-not (Test-Path -LiteralPath $WorkbookPath -PathType Leaf)) {
    throw "Excel file not found: $WorkbookPath"
  }

  $json = [Console]::In.ReadToEnd()
  if ([string]::IsNullOrWhiteSpace($json)) { throw 'No data received for Excel write' }
  $data = $json | ConvertFrom-Json

  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $workbook = $excel.Workbooks.Open($WorkbookPath, 0, $false)
  if ($workbook.ReadOnly) { throw 'Workbook is read-only or locked' }

  $worksheet = $workbook.Worksheets.Item($SheetName)
  if ($worksheet.ListObjects.Count -lt 1) { throw "Sheet $SheetName has no Excel Table" }

  foreach ($candidate in $worksheet.ListObjects) {
    $headers = @()
    for ($column = 1; $column -le $candidate.ListColumns.Count; $column++) {
      $headers += [string]$candidate.HeaderRowRange.Cells.Item(1, $column).Value2
    }
    $missing = @($data.PSObject.Properties.Name | Where-Object { $_ -notin $headers })
    if ($missing.Count -eq 0) { $table = $candidate; break }
  }
  if ($null -eq $table) { throw "No table in sheet $SheetName matches the submitted columns" }

  if ($data.PSObject.Properties.Name -contains 'Submission_ID') {
    $submissionColumn = $table.ListColumns.Item('Submission_ID')
    if ($null -ne $submissionColumn.DataBodyRange) {
      foreach ($existingCell in $submissionColumn.DataBodyRange.Cells) {
        if ([string]$existingCell.Value2 -eq [string]$data.Submission_ID) {
          throw "Duplicate Submission_ID: $($data.Submission_ID)"
        }
      }
    }
  }

  if ($null -ne $table.DataBodyRange) {
    for ($row = 1; $row -le $table.DataBodyRange.Rows.Count; $row++) {
      $hasValue = $false
      for ($column = 1; $column -le $table.ListColumns.Count; $column++) {
        $value = $table.DataBodyRange.Cells.Item($row, $column).Value2
        if ($null -ne $value -and [string]$value -ne '') { $hasValue = $true; break }
      }
      if (-not $hasValue) { $rowRange = $table.DataBodyRange.Rows.Item($row); break }
    }
  }
  if ($null -eq $rowRange) { $rowRange = $table.ListRows.Add().Range }

  foreach ($property in $data.PSObject.Properties) {
    $columnIndex = $table.ListColumns.Item($property.Name).Index
    $cell = $rowRange.Cells.Item(1, $columnIndex)
    $value = $property.Value
    if ($null -eq $value) {
      $cell.ClearContents()
    } elseif ($property.Name -eq 'listing_id') {
      $cell.NumberFormat = '@'
      $cell.Value2 = [string]$value
    } elseif ($property.Name -eq 'date') {
      $dateValue = [DateTime]::ParseExact([string]$value, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
      $cell.NumberFormat = 'yyyy-mm-dd'
      $cell.Value2 = $dateValue.ToOADate()
      if ($cell.EntireColumn.ColumnWidth -lt 12) { $cell.EntireColumn.ColumnWidth = 12 }
    } elseif ($property.Name -eq 'Timestamp') {
      $timestampText = [string]$value
      $timestampFormat = if ($timestampText.Length -eq 16) { 'yyyy-MM-ddTHH:mm' } else { 'yyyy-MM-ddTHH:mm:ss' }
      $dateValue = [DateTime]::ParseExact($timestampText, $timestampFormat, [Globalization.CultureInfo]::InvariantCulture)
      $cell.NumberFormat = 'yyyy-mm-dd hh:mm'
      $cell.Value2 = $dateValue.ToOADate()
    } elseif ($value -is [int] -or $value -is [long] -or $value -is [double] -or $value -is [decimal]) {
      $cell.Value2 = [double]$value
    } else {
      $cell.Value2 = [string]$value
    }
  }

  $absoluteRow = $rowRange.Row
  $calculationRange = $worksheet.Range("J${absoluteRow}:U${absoluteRow}")
  [void]$calculationRange.Calculate()

  $calculatedValues = [ordered]@{}
  foreach ($columnName in @(
    'Market_Mean_Price', 'Market_Median_Price', 'Market_SD_Price', 'Market_Est_Occupancy',
    'Price_Percentile', 'Z_Score', 'Price_Status', 'BreakEven_Nights',
    'BreakEven_Occupancy', 'GoalSeek_Target_Price', 'Feasibility_Verdict'
  )) {
    $columnIndex = $table.ListColumns.Item($columnName).Index
    $resultCell = $rowRange.Cells.Item(1, $columnIndex)
    $resultValue = $resultCell.Value2
    if ([string]$resultCell.Text -match '^#') { $resultValue = [string]$resultCell.Text }
    $calculatedValues[$columnName] = $resultValue
  }

  $workbook.Save()
  Write-Result @{ ok = $true; table_name = $table.Name; row_number = $absoluteRow; calculated_values = $calculatedValues }
} catch {
  Write-Result @{ ok = $false; message = $_.Exception.Message }
  exit 1
} finally {
  if ($null -ne $workbook) { try { $workbook.Close($false) } catch {} }
  if ($null -ne $excel) { try { $excel.Quit() } catch {} }
  foreach ($item in @($calculationRange, $rowRange, $table, $worksheet, $workbook, $excel)) {
    if ($null -ne $item -and [Runtime.InteropServices.Marshal]::IsComObject($item)) {
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($item)
    }
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
