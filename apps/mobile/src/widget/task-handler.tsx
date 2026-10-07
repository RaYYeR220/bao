'use no memo'

import { requestWidgetUpdate, type WidgetTaskHandlerProps } from 'react-native-android-widget'

import { BaoWidget } from './bao-widget'
import { loadWidgetData } from './widget-data'

export const WIDGET_NAME = 'BaoPackets'

/** Launcher → JS: render on add, on the periodic update and on resize. */
export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED': {
      props.renderWidget(<BaoWidget data={null} />)
      try {
        props.renderWidget(<BaoWidget data={await loadWidgetData()} />)
      } catch {
        // keep the placeholder; the next update retries
      }
      break
    }
    default:
      break
  }
}

/** App → launcher: refresh every placed widget (on foreground, after a grab or drop, on push). */
export async function refreshWidget() {
  try {
    const data = await loadWidgetData()
    await requestWidgetUpdate({ widgetName: WIDGET_NAME, renderWidget: () => <BaoWidget data={data} /> })
  } catch {
    // no widget placed, or offline
  }
}
