// Safari requires an App-Sandboxed app extension. It cannot start the Node
// bridge or read its registry; notes stay local and are copied out instead.
import SafariServices

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: [
            "ok": false,
            "error": "Native messaging is unavailable in Safari. Copy the round instead.",
        ]]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
