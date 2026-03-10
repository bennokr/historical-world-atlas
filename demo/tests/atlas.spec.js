/**
 * Playwright tests for the Cliopatria DuckDB-wasm demo.
 *
 * Covers:
 *  1. Page structure & initial state
 *  2. DuckDB-wasm initialisation (spatial extension, parquet registration)
 *  3. Default year query (map + results table populated)
 *  4. Year slider interaction
 *  5. Custom SQL query via the editor
 *  6. Popup on feature click
 *  7. Play / pause animation
 *  8. Schema panel toggle
 *  9. Edge-case SQL (empty results, syntax error)
 */

import { test, expect } from '@playwright/test'

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Wait until the status bar shows "Ready" (DuckDB fully initialised). */
async function waitForReady(page) {
  await expect(page.locator('#status-text')).toHaveText(/Ready|polities/, {
    timeout: 180_000,
  })
}

/** Run a SQL string via the editor and wait for duration text to appear. */
async function runQuery(page, sql) {
  await page.locator('#sql-editor').fill(sql)
  await page.locator('#run-btn').click()
  // Wait for query-duration to show timing info
  await expect(page.locator('#query-duration')).toHaveText(/rows|polities/, {
    timeout: 60_000,
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('1 · Page structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('title is correct', async ({ page }) => {
    await expect(page).toHaveTitle(/Cliopatria/)
  })

  test('header brand text is visible', async ({ page }) => {
    await expect(page.locator('#brand h1')).toHaveText('Cliopatria')
  })

  test('subtitle shows date range', async ({ page }) => {
    await expect(page.locator('#subtitle')).toContainText('3400 BCE')
    await expect(page.locator('#subtitle')).toContainText('2024 CE')
  })

  test('year slider starts at -3400', async ({ page }) => {
    await expect(page.locator('#year-slider')).toHaveValue('-3400')
  })

  test('year label shows "3400 BCE" initially', async ({ page }) => {
    await expect(page.locator('#year-label')).toHaveText('3400 BCE')
  })

  test('controls are disabled before DuckDB is ready', async ({ page }) => {
    // Capture the very early state before DuckDB finishes (might already be done
    // if the server is warm, so we only assert if the text is still "Initializing")
    const statusText = await page.locator('#status-text').textContent()
    if (statusText && statusText.includes('Initializ')) {
      await expect(page.locator('#run-btn')).toBeDisabled()
      await expect(page.locator('#play-btn')).toBeDisabled()
      await expect(page.locator('#year-slider')).toBeDisabled()
    }
  })
})

test.describe('2 · DuckDB initialisation', () => {
  test('status reaches Ready and controls become enabled', async ({ page }) => {
    await page.goto('/')
    await waitForReady(page)

    await expect(page.locator('#run-btn')).toBeEnabled()
    await expect(page.locator('#play-btn')).toBeEnabled()
    await expect(page.locator('#year-slider')).toBeEnabled()
    await expect(page.locator('#sql-editor')).toBeEnabled()
  })

  test('status icon turns to ✓ when ready', async ({ page }) => {
    await page.goto('/')
    await waitForReady(page)
    await expect(page.locator('#status-icon')).toHaveText('✓')
  })
})

test.describe('3 · Default year query', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForReady(page)
  })

  test('SQL editor is populated with a SELECT statement', async ({ page }) => {
    const sql = await page.locator('#sql-editor').inputValue()
    expect(sql).toContain('SELECT')
    expect(sql).toContain('read_parquet')
    expect(sql).toContain('FromYear')
    expect(sql).toContain('ToYear')
  })

  test('query-duration shows row count after first load', async ({ page }) => {
    await expect(page.locator('#query-duration')).toHaveText(/\d+ polities/, {
      timeout: 60_000,
    })
  })

  test('results table has header columns', async ({ page }) => {
    await expect(page.locator('#results-content table thead th').first()).toBeVisible({
      timeout: 60_000,
    })
    const headers = await page.locator('#results-content table thead th').allTextContents()
    expect(headers).toContain('Name')
    expect(headers).toContain('FromYear')
    expect(headers).toContain('ToYear')
  })

  test('results table has at least one data row', async ({ page }) => {
    await expect(page.locator('#results-content table tbody tr').first()).toBeVisible({
      timeout: 60_000,
    })
    const count = await page.locator('#results-content table tbody tr').count()
    expect(count).toBeGreaterThan(0)
  })

  test('results count badge is populated', async ({ page }) => {
    await expect(page.locator('#results-count')).not.toHaveText('', { timeout: 60_000 })
    const text = await page.locator('#results-count').textContent()
    expect(parseInt(text ?? '0')).toBeGreaterThan(0)
  })

  test('map has at least one SVG path (polygon layer)', async ({ page }) => {
    // Leaflet renders polity polygons as SVG <path> elements
    await expect(page.locator('#map svg path').first()).toBeVisible({ timeout: 60_000 })
    const pathCount = await page.locator('#map svg path').count()
    expect(pathCount).toBeGreaterThan(0)
  })
})

test.describe('4 · Year slider', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForReady(page)
    // Wait for initial query to complete
    await expect(page.locator('#query-duration')).toHaveText(/polities/, { timeout: 60_000 })
  })

  test('dragging slider updates year label', async ({ page }) => {
    await page.locator('#year-slider').fill('0')
    await page.locator('#year-slider').dispatchEvent('input')
    await expect(page.locator('#year-label')).toHaveText('1 CE')
  })

  test('releasing slider triggers a new query', async ({ page }) => {
    await page.locator('#year-slider').fill('500')
    await page.locator('#year-slider').dispatchEvent('input')
    await page.locator('#year-slider').dispatchEvent('change')

    // Duration line should update to reflect the new year query
    await expect(page.locator('#query-duration')).toHaveText(/polities/, { timeout: 60_000 })

    const sql = await page.locator('#sql-editor').inputValue()
    expect(sql).toContain('500')
  })

  test('CE years show correct format in label', async ({ page }) => {
    // Use evaluate() to bypass the step=50 constraint and set an arbitrary year
    await page.locator('#year-slider').fill('1066')
    await page.locator('#year-slider').dispatchEvent('input')
    await expect(page.locator('#year-label')).toHaveText('1066 CE')
  })

  test('BCE years show correct format in label', async ({ page }) => {
    await page.locator('#year-slider').fill('-500')
    await page.locator('#year-slider').dispatchEvent('input')
    await expect(page.locator('#year-label')).toHaveText('500 BCE')
  })
})

test.describe('5 · Custom SQL queries', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForReady(page)
    await expect(page.locator('#query-duration')).toHaveText(/polities/, { timeout: 60_000 })
  })

  test('custom COUNT query returns a numeric result', async ({ page }) => {
    await runQuery(
      page,
      `SELECT COUNT(*) AS total
       FROM read_parquet('cliopatria.parquet')
       WHERE FromYear <= 0 AND ToYear >= 0;`
    )
    const rows = await page.locator('#results-content table tbody tr').count()
    expect(rows).toBeGreaterThan(0)
    const cell = await page.locator('#results-content table tbody tr td').first().textContent()
    expect(parseInt(cell ?? '0')).toBeGreaterThan(0)
  })

  test('spatial ST_AsGeoJSON query renders polygons on map', async ({ page }) => {
    const initialPaths = await page.locator('#map svg path').count()

    await runQuery(
      page,
      `SELECT Name, FromYear, ToYear, Area,
              ROUND(Area/1e6,2) AS area_Mkm2,
              Color, Wikipedia,
              ST_AsGeoJSON(geometry) AS geom_json
       FROM read_parquet('cliopatria.parquet')
       WHERE FromYear <= 1000 AND ToYear >= 1000
         AND (MemberOf = '' OR MemberOf IS NULL)
       ORDER BY Area DESC
       LIMIT 20;`
    )
    const newPaths = await page.locator('#map svg path').count()
    // Map should have been updated with new paths
    expect(newPaths).toBeGreaterThan(0)
  })

  test('aggregation query (no geometry) shows table without crashing', async ({ page }) => {
    await runQuery(
      page,
      `SELECT (FromYear / 100)*100 AS century,
              COUNT(DISTINCT Name)  AS polities
       FROM read_parquet('cliopatria.parquet')
       WHERE MemberOf = '' OR MemberOf IS NULL
       GROUP BY 1 ORDER BY 1 LIMIT 10;`
    )
    const rows = await page.locator('#results-content table tbody tr').count()
    expect(rows).toBeGreaterThan(0)
  })

  test('Ctrl+Enter runs the query', async ({ page }) => {
    const editor = page.locator('#sql-editor')
    await editor.fill(`SELECT COUNT(*) AS n FROM read_parquet('cliopatria.parquet');`)
    await editor.press('Control+Enter')
    await expect(page.locator('#query-duration')).toHaveText(/rows/, { timeout: 60_000 })
  })

  test('reset button restores default query', async ({ page }) => {
    const editor = page.locator('#sql-editor')
    await editor.fill('SELECT 1;')
    await page.locator('#reset-query-btn').click()
    const sql = await editor.inputValue()
    expect(sql).toContain('read_parquet')
    expect(sql).toContain('FromYear')
  })
})

test.describe('6 · Map popups', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForReady(page)
    // Navigate to 500 CE where there should be clear polygons visible
    await page.locator('#year-slider').fill('500')
    await page.locator('#year-slider').dispatchEvent('input')
    await page.locator('#year-slider').dispatchEvent('change')
    await expect(page.locator('#query-duration')).toHaveText(/polities/, { timeout: 60_000 })
    await expect(page.locator('#map svg path').first()).toBeVisible({ timeout: 30_000 })
  })

  test('clicking a map polygon opens a popup with polity name', async ({ page }) => {
    const firstPath = page.locator('#map svg path').first()
    await firstPath.click({ force: true })
    await expect(page.locator('.leaflet-popup')).toBeVisible({ timeout: 10_000 })
    // Popup should contain the years section
    await expect(page.locator('.popup-years')).toBeVisible()
  })
})

test.describe('7 · Play / pause animation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForReady(page)
    await expect(page.locator('#query-duration')).toHaveText(/polities/, { timeout: 60_000 })
  })

  test('play button changes to pause icon when clicked', async ({ page }) => {
    await page.locator('#play-btn').click()
    await expect(page.locator('#play-btn')).toHaveText('⏸')
  })

  test('clicking pause stops animation and restores play icon', async ({ page }) => {
    await page.locator('#play-btn').click()
    await expect(page.locator('#play-btn')).toHaveText('⏸')
    await page.locator('#play-btn').click()
    await expect(page.locator('#play-btn')).toHaveText('▶')
  })

  test('year advances during animation', async ({ page }) => {
    const before = await page.locator('#year-slider').inputValue()
    await page.locator('#play-btn').click()
    // Wait for at least one animation step (up to 3 s)
    await page.waitForTimeout(2_000)
    const after = await page.locator('#year-slider').inputValue()
    await page.locator('#play-btn').click()  // stop
    expect(parseInt(after)).toBeGreaterThan(parseInt(before))
  })
})

test.describe('8 · Schema panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('schema table lists expected columns', async ({ page }) => {
    const cols = await page.locator('.schema-table tbody td:first-child').allTextContents()
    expect(cols).toContain('Name')
    expect(cols).toContain('FromYear')
    expect(cols).toContain('ToYear')
    expect(cols).toContain('geometry')
    expect(cols).toContain('Color')
  })

  test('toggle button hides / shows schema content', async ({ page }) => {
    const content = page.locator('#schema-content')
    await expect(content).toBeVisible()

    await page.locator('#toggle-schema-btn').click()
    await expect(content).toBeHidden()

    await page.locator('#toggle-schema-btn').click()
    await expect(content).toBeVisible()
  })
})

test.describe('9 · Edge cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForReady(page)
    await expect(page.locator('#query-duration')).toHaveText(/polities/, { timeout: 60_000 })
  })

  test('query with no results shows 0 in results count', async ({ page }) => {
    await runQuery(
      page,
      // Intentionally impossible year range
      `SELECT Name, ROUND(Area/1e6,2) AS area_Mkm2, Color, Wikipedia,
              ST_AsGeoJSON(geometry) AS geom_json
       FROM read_parquet('cliopatria.parquet')
       WHERE FromYear > 99999;`
    )
    const count = await page.locator('#results-count').textContent()
    expect(count?.trim()).toBe('0')
  })

  test('SQL syntax error shows an error message', async ({ page }) => {
    await page.locator('#sql-editor').fill('SELECT INVALID SYNTAX @@@@;')
    await page.locator('#run-btn').click()
    await expect(page.locator('#query-error')).not.toBeEmpty({ timeout: 30_000 })
  })

  test('year 0 displays as "1 CE"', async ({ page }) => {
    await page.locator('#year-slider').fill('0')
    await page.locator('#year-slider').dispatchEvent('input')
    await expect(page.locator('#year-label')).toHaveText('1 CE')
  })

  test('max year 2024 is reachable and shows CE label', async ({ page }) => {
    await page.locator('#year-slider').fill('2024')
    await page.locator('#year-slider').dispatchEvent('input')
    await expect(page.locator('#year-label')).toHaveText('2024 CE')
  })
})
