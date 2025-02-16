const { SeverityNumber } = require('@opentelemetry/api-logs')
const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-http')
const { LoggerProvider, SimpleLogRecordProcessor } = require('@opentelemetry/sdk-logs')
const { trace, context } = require('@opentelemetry/api')
const { Resource } = require('@opentelemetry/resources')
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions')

module.exports = function (RED) {
  function LokiExporterNode(config) {
    RED.nodes.createNode(this, config)
    const node = this
    
    // Configuration
    node.url = config.url || 'http://localhost:3100/loki/api/v1/push'
    node.serviceName = config.serviceName || 'node-red'
    node.labels = {}
    
    // Parse labels
    if (config.labels) {
      node.labels = config.labels.split(',').reduce((acc, pair) => {
        const [key, value] = pair.split('=')
        if (key && value) acc[key.trim()] = value.trim()
        return acc
      }, {})
    }

    // Setup logger provider with resource attributes
    const resource = new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: node.serviceName,
    })
    
    const loggerProvider = new LoggerProvider({
      resource: resource
    })

    const exporter = new OTLPLogExporter({
      url: node.url,
      headers: { 'Content-Type': 'application/json' }
    })
    
    loggerProvider.addLogRecordProcessor(new SimpleLogRecordProcessor(exporter))
    node.logger = loggerProvider.getLogger('node-red-logs', '1.0.0')

    // Check connection and update status
    const checkConnection = () => {
      fetch(node.url, { method: 'HEAD' })
        .then(() => {
          node.status({fill:"green",shape:"dot",text:"connected"})
        })
        .catch((error) => {
          node.status({fill:"red",shape:"ring",text:"disconnected"})
          node.error(`Connection error: ${error.message}`)
        })
    }

    // Initial connection check
    checkConnection()
    
    node.on('input', (msg) => {
      try {
        const spanContext = trace.getSpanContext(context.active())
        const attributes = {
          ...node.labels,
          service: node.serviceName,
          spanId: msg.spanId || spanContext?.spanId,
          traceId: msg.traceId || spanContext?.traceId,
          flowId: msg.flow?.id,
          nodeId: msg.node?.id
        }

        node.logger.emit({
          severityNumber: SeverityNumber.INFO,
          severityText: 'INFO',
          body: msg.payload,
          attributes: attributes
        })

        node.send(msg)
      } catch (error) {
        node.error('Error sending log to Loki: ' + error.message)
        node.status({fill:"red",shape:"ring",text:"error"})
      }
    })

    node.on('close', () => {
      loggerProvider.shutdown()
      node.status({})
    })
  }

  RED.nodes.registerType('Loki', LokiExporterNode)
} 