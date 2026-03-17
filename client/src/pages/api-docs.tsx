import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Copy, Check, ExternalLink, GitMerge } from "lucide-react";

export default function ApiDocsPage() {
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(id);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://dc4ai.replit.app';

  const isProduction = baseUrl.includes('.replit.app');

  const getDevUrl = () => {
    if (isProduction) {
      const appName = baseUrl.replace('https://', '').replace('.replit.app', '');
      return `https://${appName}.replit.dev`;
    }
    return baseUrl;
  };

  const getProdUrl = () => {
    if (isProduction) return baseUrl;
    return baseUrl
      .replace(/-00-/g, '-')
      .replace(/\.[\w]+\.replit\.dev/, '.replit.app');
  };

  const stagingUrl = getDevUrl();
  const productionUrl = getProdUrl();

  // ── Single-source examples ────────────────────────────────────────────────
  const curlExample = `curl -X GET "${baseUrl}/api/v1/fetch?columns=city_name,title&limit=10" \\
  -H "x-api-key: dc4ai_your-api-key-here" \\
  -H "x-data-source: crime" \\
  -H "Accept: application/json"`;

  const pythonExample = `import requests

url = "${baseUrl}/api/v1/fetch"
headers = {
    "x-api-key": "dc4ai_your-api-key-here",
    "x-data-source": "crime",
    "Accept": "application/json"
}
params = {
    "columns": "city_name,title",
    "limit": 10
}

response = requests.get(url, headers=headers, params=params)
data = response.json()
print(data)`;

  const javascriptExample = `const response = await fetch(
  "${baseUrl}/api/v1/fetch?columns=city_name,title&limit=10",
  {
    method: "GET",
    headers: {
      "x-api-key": "dc4ai_your-api-key-here",
      "x-data-source": "crime",
      "Accept": "application/json"
    }
  }
);

const data = await response.json();
console.log(data);`;

  // ── Multi-source JOIN examples ────────────────────────────────────────────
  const curlJoinExample = `curl -X GET "${baseUrl}/api/v1/fetch?columns=city_name,postal_code,title,event_name&limit=10" \\
  -H "x-api-key: dc4ai_your-api-key-here" \\
  -H "x-data-sources: crime,events" \\
  -H "Accept: application/json"`;

  const pythonJoinExample = `import requests

url = "${baseUrl}/api/v1/fetch"
headers = {
    "x-api-key": "dc4ai_your-api-key-here",
    "x-data-sources": "crime,events",   # comma-separated sources
    "Accept": "application/json"
}
params = {
    # columns from any of the selected sources
    "columns": "city_name,postal_code,title,event_name",
    "limit": 10,
    # filters must be on common (join) columns only
    "city_name": "Berlin"
}

response = requests.get(url, headers=headers, params=params)
data = response.json()
print(data)`;

  const javascriptJoinExample = `const params = new URLSearchParams({
  columns: "city_name,postal_code,title,event_name",
  limit: "10",
  city_name: "Berlin"   // filter on a common column
});

const response = await fetch(
  \`${baseUrl}/api/v1/fetch?\${params}\`,
  {
    method: "GET",
    headers: {
      "x-api-key": "dc4ai_your-api-key-here",
      "x-data-sources": "crime,events",
      "Accept": "application/json"
    }
  }
);

const data = await response.json();
console.log(data);`;

  // ── Response examples ─────────────────────────────────────────────────────
  const successResponse = `{
  "data": [
    {
      "city_name": "Berlin",
      "title": "Traffic incident on A100"
    },
    {
      "city_name": "Munich",
      "title": "Road construction update"
    }
  ],
  "meta": {
    "columns": ["city_name", "title"],
    "totalRows": 2,
    "limit": 10,
    "offset": 0,
    "executionTimeMs": 1523
  }
}`;

  const successJoinResponse = `{
  "data": [
    {
      "city_name": "Berlin",
      "postal_code": "10115",
      "title": "Theft on Alexanderplatz",
      "event_name": "Berlin Marathon 2025"
    }
  ],
  "meta": {
    "columns": ["city_name", "postal_code", "title", "event_name"],
    "totalRows": 1,
    "limit": 10,
    "joinMode": true,
    "sources": ["crime-data-db", "events-data-db"],
    "joinColumns": ["city_name", "postal_code"],
    "executionTimeMs": 2841
  }
}`;

  const errorResponse401 = `{
  "message": "Invalid or revoked API key"
}`;

  const errorResponse403 = `{
  "message": "Access Denied!! You do not have Lake Formation permissions to access column: secret_column in crime",
  "allowedColumns": ["city_name", "title", "date_time"]
}`;

  const errorResponse400 = `{
  "message": "No common columns found between the selected data sources.",
  "sources": [
    { "id": "crime-data-db", "columns": ["location","title",...] },
    { "id": "insurance-data-db", "columns": ["policyholder_id",...] }
  ]
}`;

  const errorResponse500 = `{
  "message": "Query execution failed"
}`;

  return (
    <div className="h-full overflow-auto">
      <div className="flex">
        <div className="flex-1 p-6 max-w-4xl">
          <div className="space-y-8">
            <div>
              <Badge variant="outline" className="mb-2">REST API</Badge>
              <h1 className="text-3xl font-bold" data-testid="text-api-docs-title">Fetch Data</h1>
              <p className="text-muted-foreground mt-2">
                Retrieve data from one or more data sources with column selection, filtering, and optional multi-source LEFT JOINs.
              </p>
            </div>

            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg font-mono text-sm">
              <Badge className="bg-green-600 hover:bg-green-600">GET</Badge>
              <span className="text-muted-foreground">/api/v1/fetch</span>
            </div>

            {/* Overview */}
            <section id="overview">
              <h2 className="text-xl font-semibold mb-4">Overview</h2>
              <p className="text-muted-foreground">
                The DC4AI Public API allows you to programmatically access data from the platform.
                Use your API key to authenticate requests and retrieve data from authorized data sources.
                All requests inherit the permissions of the user who created the API key, including
                column-level and row-level access restrictions.
              </p>
              <p className="text-muted-foreground mt-2">
                You can query a <strong>single data source</strong> using the <code className="bg-muted px-1 rounded">x-data-source</code> header,
                or perform a <strong>multi-source LEFT JOIN</strong> across two or more sources using the <code className="bg-muted px-1 rounded">x-data-sources</code> header.
              </p>
            </section>

            {/* Base URL */}
            <section id="base-url" data-testid="section-base-url">
              <h2 className="text-xl font-semibold mb-4">Base URL</h2>
              <Table data-testid="table-base-url">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-32">Environment</TableHead>
                    <TableHead>URL</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell><Badge variant="outline">Staging</Badge></TableCell>
                    <TableCell className="font-mono text-sm">{stagingUrl}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell><Badge variant="secondary">Production</Badge></TableCell>
                    <TableCell className="font-mono text-sm">{productionUrl}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </section>

            {/* Headers */}
            <section id="headers" data-testid="section-headers">
              <h2 className="text-xl font-semibold mb-4">Headers</h2>
              <Table data-testid="table-headers">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-44">Key</TableHead>
                    <TableHead className="w-40">Value</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-mono text-sm">
                      x-api-key
                      <Badge variant="destructive" className="ml-2 text-xs">required</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">dc4ai_xxx...</TableCell>
                    <TableCell>
                      Your API key generated from the API Keys page. Keys are prefixed with <code className="bg-muted px-1 rounded">dc4ai_</code>.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-mono text-sm">
                      x-data-source
                      <Badge variant="outline" className="ml-2 text-xs">single source</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">crime</TableCell>
                    <TableCell>
                      Short name of the data source to query. Use this for single-source queries.
                      Accepted values: <code className="bg-muted px-1 rounded">crime</code>, <code className="bg-muted px-1 rounded">events</code>, <code className="bg-muted px-1 rounded">insurance</code>, <code className="bg-muted px-1 rounded">traffic</code>, <code className="bg-muted px-1 rounded">weather</code>.
                    </TableCell>
                  </TableRow>
                  <TableRow className="bg-muted/30">
                    <TableCell className="font-mono text-sm">
                      x-data-sources
                      <Badge variant="outline" className="ml-2 text-xs">multi-source JOIN</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">crime,events</TableCell>
                    <TableCell>
                      Comma-separated list of <strong>two or more</strong> data source short names to JOIN together.
                      Cannot be used together with <code className="bg-muted px-1 rounded">x-data-source</code>.
                      Sources are joined via LEFT JOIN on their common columns. See the Multi-Source JOIN section below.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-mono text-sm">Accept</TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">application/json</TableCell>
                    <TableCell>
                      Response format. Use <code className="bg-muted px-1 rounded">application/json</code> (default) or <code className="bg-muted px-1 rounded">text/csv</code> for a CSV download.
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              <p className="text-sm text-muted-foreground mt-2">
                You must provide <strong>either</strong> <code className="bg-muted px-1 rounded">x-data-source</code> (single) <strong>or</strong> <code className="bg-muted px-1 rounded">x-data-sources</code> (multi-source JOIN).
              </p>
            </section>

            {/* Query Parameters */}
            <section id="query-params" data-testid="section-query-params">
              <h2 className="text-xl font-semibold mb-4">Query Parameters</h2>
              <Table data-testid="table-query-params">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-44">Key</TableHead>
                    <TableHead className="w-32">Type</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-mono text-sm">columns</TableCell>
                    <TableCell className="text-muted-foreground">string</TableCell>
                    <TableCell>
                      Comma-separated list of column names to return. If omitted, returns all columns you have access to.
                      In multi-source mode, you can request columns from <em>any</em> of the selected sources.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-mono text-sm">limit</TableCell>
                    <TableCell className="text-muted-foreground">integer</TableCell>
                    <TableCell>
                      Maximum number of rows to return. Default: 100, Maximum: 1000.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-mono text-sm">
                      <span className="text-muted-foreground italic">[column_name]</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">string</TableCell>
                    <TableCell>
                      Any additional parameter is treated as an equals filter. For example, <code className="bg-muted px-1 rounded">city_name=Berlin</code> filters rows where city_name equals "Berlin".
                      German characters are automatically normalised (ä→a, ö→o, ü→u) and matching is case-insensitive.
                      In multi-source JOIN mode, filters are only applied to <strong>common (join) columns</strong>.
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </section>

            {/* Multi-Source JOIN */}
            <section id="multi-source-join" data-testid="section-multi-source-join">
              <div className="flex items-center gap-2 mb-4">
                <GitMerge className="h-5 w-5 text-primary" />
                <h2 className="text-xl font-semibold">Multi-Source JOIN</h2>
                <Badge variant="secondary">New</Badge>
              </div>
              <p className="text-muted-foreground mb-4">
                Use the <code className="bg-muted px-1 rounded">x-data-sources</code> header to query two or more data sources at once.
                The API performs a <strong>LEFT JOIN</strong> on the columns that are common to all selected sources,
                and returns columns from any of them in a single response — exactly like the multi-source mode in the Data Viewer UI.
              </p>

              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">How it works</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm text-muted-foreground">
                    <p>1. <strong>Common columns</strong> — The API fetches the schema for each source and finds columns that exist in <em>all</em> selected sources. These become the JOIN keys (e.g. <code className="bg-muted px-1 rounded">city_name</code>, <code className="bg-muted px-1 rounded">postal_code</code>).</p>
                    <p>2. <strong>LEFT JOIN</strong> — The first source in the list becomes the primary (left) table. All subsequent sources are LEFT JOINed onto it using the common columns.</p>
                    <p>3. <strong>Column selection</strong> — You can request columns from any of the selected sources in the <code className="bg-muted px-1 rounded">columns</code> parameter. Common columns are resolved from the primary table.</p>
                    <p>4. <strong>Filters</strong> — Row filters (query parameters) in JOIN mode are only applied to <strong>common columns</strong>. Filters on source-specific columns are silently ignored.</p>
                    <p>5. <strong>Permissions</strong> — Your role must have access to <em>all</em> requested sources. Column and row-level restrictions from each source are applied independently.</p>
                    <p>6. <strong>Type mismatches</strong> — If a join column has different types across sources (e.g. INT vs VARCHAR), the API automatically wraps it in <code className="bg-muted px-1 rounded">CAST(... AS VARCHAR)</code> on both sides to prevent errors.</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Available data sources &amp; short names</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Short name</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Description</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {[
                          { short: "crime",     name: "Crime Data",     desc: "Crime statistics and incident data" },
                          { short: "events",    name: "Events Data",    desc: "Event scheduling and tracking data" },
                          { short: "insurance", name: "Insurance Data", desc: "Policy and claims data for insurance analytics" },
                          { short: "traffic",   name: "Traffic Data",   desc: "Traffic flow and incident data" },
                          { short: "weather",   name: "Weather Data",   desc: "Weather conditions and forecasts" },
                        ].map(ds => (
                          <TableRow key={ds.short}>
                            <TableCell><code className="bg-muted px-1 rounded">{ds.short}</code></TableCell>
                            <TableCell className="text-muted-foreground text-sm">{ds.name}</TableCell>
                            <TableCell className="text-muted-foreground text-sm">{ds.desc}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            </section>

            {/* Response */}
            <section id="response" data-testid="section-response">
              <h2 className="text-xl font-semibold mb-4">Response</h2>
              <p className="text-muted-foreground mb-4">
                Successful responses return JSON with a <code className="bg-muted px-1 rounded">data</code> array and a <code className="bg-muted px-1 rounded">meta</code> object.
                Multi-source JOIN responses include additional fields in <code className="bg-muted px-1 rounded">meta</code>.
              </p>

              <h3 className="text-lg font-medium mb-3">Data Dictionary</h3>
              <Table data-testid="table-data-dictionary">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-52">Field</TableHead>
                    <TableHead className="w-32">Type</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-mono text-sm">data</TableCell>
                    <TableCell className="text-muted-foreground">array</TableCell>
                    <TableCell>Array of row objects containing the requested columns.</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-mono text-sm">meta.columns</TableCell>
                    <TableCell className="text-muted-foreground">string[]</TableCell>
                    <TableCell>List of column names returned in the response.</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-mono text-sm">meta.totalRows</TableCell>
                    <TableCell className="text-muted-foreground">integer</TableCell>
                    <TableCell>Number of rows returned in this response.</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-mono text-sm">meta.limit</TableCell>
                    <TableCell className="text-muted-foreground">integer</TableCell>
                    <TableCell>The limit used for this query.</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-mono text-sm">meta.executionTimeMs</TableCell>
                    <TableCell className="text-muted-foreground">integer</TableCell>
                    <TableCell>Query execution time in milliseconds.</TableCell>
                  </TableRow>
                  <TableRow className="bg-muted/30">
                    <TableCell className="font-mono text-sm">meta.joinMode</TableCell>
                    <TableCell className="text-muted-foreground">boolean</TableCell>
                    <TableCell><em>Multi-source only.</em> Always <code className="bg-muted px-1 rounded">true</code> when using <code className="bg-muted px-1 rounded">x-data-sources</code>.</TableCell>
                  </TableRow>
                  <TableRow className="bg-muted/30">
                    <TableCell className="font-mono text-sm">meta.sources</TableCell>
                    <TableCell className="text-muted-foreground">string[]</TableCell>
                    <TableCell><em>Multi-source only.</em> The resolved IDs of the sources that were joined.</TableCell>
                  </TableRow>
                  <TableRow className="bg-muted/30">
                    <TableCell className="font-mono text-sm">meta.joinColumns</TableCell>
                    <TableCell className="text-muted-foreground">string[]</TableCell>
                    <TableCell><em>Multi-source only.</em> The columns used as JOIN keys (common across all sources). Useful for understanding which filters are valid.</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </section>

            {/* Response Codes */}
            <section id="response-codes" data-testid="section-response-codes">
              <h2 className="text-xl font-semibold mb-4">Response Codes</h2>
              <Table data-testid="table-response-codes">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-32">Code</TableHead>
                    <TableHead className="w-40">Status</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell><Badge className="bg-green-600 hover:bg-green-600">200</Badge></TableCell>
                    <TableCell>OK</TableCell>
                    <TableCell>Request successful. Data returned in the response body.</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell><Badge variant="destructive">400</Badge></TableCell>
                    <TableCell>Bad Request</TableCell>
                    <TableCell>Missing/invalid headers, invalid data source name, or no common columns found between sources in JOIN mode.</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell><Badge variant="destructive">401</Badge></TableCell>
                    <TableCell>Unauthorized</TableCell>
                    <TableCell>Invalid or revoked API key.</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell><Badge variant="destructive">403</Badge></TableCell>
                    <TableCell>Forbidden</TableCell>
                    <TableCell>Access denied to a requested data source or column.</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell><Badge variant="destructive">500</Badge></TableCell>
                    <TableCell>Server Error</TableCell>
                    <TableCell>Query execution failed or schema could not be fetched.</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </section>
          </div>
        </div>

        {/* Right panel — code examples */}
        <div className="w-[420px] border-l bg-slate-900 dark:bg-slate-950 p-4 sticky top-0 h-screen overflow-auto z-50">
          <div className="space-y-6">

            {/* Mode selector */}
            <Tabs defaultValue="single" className="w-full" data-testid="tabs-mode">
              <TabsList className="bg-slate-800 w-full mb-3">
                <TabsTrigger value="single" className="text-xs flex-1" data-testid="tab-mode-single">Single Source</TabsTrigger>
                <TabsTrigger value="join" className="text-xs flex-1" data-testid="tab-mode-join">Multi-Source JOIN</TabsTrigger>
              </TabsList>

              {/* ── Single source examples ── */}
              <TabsContent value="single" className="mt-0 space-y-4">
                <Tabs defaultValue="curl" className="w-full" data-testid="tabs-code-examples">
                  <div className="flex items-center justify-between mb-2">
                    <TabsList className="bg-slate-800">
                      <TabsTrigger value="curl" className="text-xs" data-testid="tab-curl">cURL</TabsTrigger>
                      <TabsTrigger value="python" className="text-xs" data-testid="tab-python">Python</TabsTrigger>
                      <TabsTrigger value="javascript" className="text-xs" data-testid="tab-javascript">JavaScript</TabsTrigger>
                    </TabsList>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-slate-400"
                      onClick={() => copyToClipboard(curlExample, 'single-code')}
                      data-testid="button-copy-code"
                    >
                      {copiedCode === 'single-code' ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                  <TabsContent value="curl" className="mt-0">
                    <pre className="text-xs text-slate-300 bg-slate-800 p-4 rounded-lg overflow-x-auto"><code>{curlExample}</code></pre>
                  </TabsContent>
                  <TabsContent value="python" className="mt-0">
                    <pre className="text-xs text-slate-300 bg-slate-800 p-4 rounded-lg overflow-x-auto"><code>{pythonExample}</code></pre>
                  </TabsContent>
                  <TabsContent value="javascript" className="mt-0">
                    <pre className="text-xs text-slate-300 bg-slate-800 p-4 rounded-lg overflow-x-auto"><code>{javascriptExample}</code></pre>
                  </TabsContent>
                </Tabs>

                <div>
                  <div className="text-sm text-slate-400 mb-2">Response</div>
                  <Tabs defaultValue="200" className="w-full" data-testid="tabs-response">
                    <TabsList className="bg-slate-800 mb-2">
                      <TabsTrigger value="200" className="text-xs data-[state=active]:bg-green-600" data-testid="tab-response-200">200</TabsTrigger>
                      <TabsTrigger value="400" className="text-xs" data-testid="tab-response-400">400</TabsTrigger>
                      <TabsTrigger value="401" className="text-xs" data-testid="tab-response-401">401</TabsTrigger>
                      <TabsTrigger value="403" className="text-xs" data-testid="tab-response-403">403</TabsTrigger>
                      <TabsTrigger value="500" className="text-xs" data-testid="tab-response-500">500</TabsTrigger>
                    </TabsList>
                    <TabsContent value="200" className="mt-0">
                      <pre className="text-xs text-slate-300 bg-slate-800 p-4 rounded-lg overflow-x-auto"><code>{successResponse}</code></pre>
                    </TabsContent>
                    <TabsContent value="400" className="mt-0">
                      <pre className="text-xs text-slate-300 bg-slate-800 p-4 rounded-lg overflow-x-auto"><code>{`{ "message": "Missing required header: x-data-source (single source) or x-data-sources (multi-source JOIN, comma-separated)" }`}</code></pre>
                    </TabsContent>
                    <TabsContent value="401" className="mt-0">
                      <pre className="text-xs text-slate-300 bg-slate-800 p-4 rounded-lg overflow-x-auto"><code>{errorResponse401}</code></pre>
                    </TabsContent>
                    <TabsContent value="403" className="mt-0">
                      <pre className="text-xs text-slate-300 bg-slate-800 p-4 rounded-lg overflow-x-auto"><code>{errorResponse403}</code></pre>
                    </TabsContent>
                    <TabsContent value="500" className="mt-0">
                      <pre className="text-xs text-slate-300 bg-slate-800 p-4 rounded-lg overflow-x-auto"><code>{errorResponse500}</code></pre>
                    </TabsContent>
                  </Tabs>
                </div>
              </TabsContent>

              {/* ── Multi-source JOIN examples ── */}
              <TabsContent value="join" className="mt-0 space-y-4">
                <div className="text-xs text-slate-400 bg-slate-800 rounded px-3 py-2">
                  Uses <code className="text-slate-200">x-data-sources: crime,events</code> — joins on common columns (<code className="text-slate-200">city_name</code>, <code className="text-slate-200">postal_code</code>).
                </div>

                <Tabs defaultValue="curl" className="w-full" data-testid="tabs-join-code-examples">
                  <div className="flex items-center justify-between mb-2">
                    <TabsList className="bg-slate-800">
                      <TabsTrigger value="curl" className="text-xs" data-testid="tab-join-curl">cURL</TabsTrigger>
                      <TabsTrigger value="python" className="text-xs" data-testid="tab-join-python">Python</TabsTrigger>
                      <TabsTrigger value="javascript" className="text-xs" data-testid="tab-join-javascript">JavaScript</TabsTrigger>
                    </TabsList>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-slate-400"
                      onClick={() => copyToClipboard(curlJoinExample, 'join-code')}
                      data-testid="button-copy-join-code"
                    >
                      {copiedCode === 'join-code' ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                  <TabsContent value="curl" className="mt-0">
                    <pre className="text-xs text-slate-300 bg-slate-800 p-4 rounded-lg overflow-x-auto"><code>{curlJoinExample}</code></pre>
                  </TabsContent>
                  <TabsContent value="python" className="mt-0">
                    <pre className="text-xs text-slate-300 bg-slate-800 p-4 rounded-lg overflow-x-auto"><code>{pythonJoinExample}</code></pre>
                  </TabsContent>
                  <TabsContent value="javascript" className="mt-0">
                    <pre className="text-xs text-slate-300 bg-slate-800 p-4 rounded-lg overflow-x-auto"><code>{javascriptJoinExample}</code></pre>
                  </TabsContent>
                </Tabs>

                <div>
                  <div className="text-sm text-slate-400 mb-2">Response</div>
                  <Tabs defaultValue="200" className="w-full" data-testid="tabs-join-response">
                    <TabsList className="bg-slate-800 mb-2">
                      <TabsTrigger value="200" className="text-xs data-[state=active]:bg-green-600" data-testid="tab-join-response-200">200</TabsTrigger>
                      <TabsTrigger value="400" className="text-xs" data-testid="tab-join-response-400">400</TabsTrigger>
                      <TabsTrigger value="401" className="text-xs" data-testid="tab-join-response-401">401</TabsTrigger>
                      <TabsTrigger value="403" className="text-xs" data-testid="tab-join-response-403">403</TabsTrigger>
                    </TabsList>
                    <TabsContent value="200" className="mt-0">
                      <pre className="text-xs text-slate-300 bg-slate-800 p-4 rounded-lg overflow-x-auto"><code>{successJoinResponse}</code></pre>
                    </TabsContent>
                    <TabsContent value="400" className="mt-0">
                      <pre className="text-xs text-slate-300 bg-slate-800 p-4 rounded-lg overflow-x-auto"><code>{errorResponse400}</code></pre>
                    </TabsContent>
                    <TabsContent value="401" className="mt-0">
                      <pre className="text-xs text-slate-300 bg-slate-800 p-4 rounded-lg overflow-x-auto"><code>{errorResponse401}</code></pre>
                    </TabsContent>
                    <TabsContent value="403" className="mt-0">
                      <pre className="text-xs text-slate-300 bg-slate-800 p-4 rounded-lg overflow-x-auto"><code>{errorResponse403}</code></pre>
                    </TabsContent>
                  </Tabs>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </div>
  );
}
