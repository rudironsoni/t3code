import ExpoModulesCore
import UIKit

public final class T3WorkspaceOrientationSubscriber: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
    if UIDevice.current.userInterfaceIdiom == .pad {
      let orientations = Bundle.main.object(forInfoDictionaryKey: "UISupportedInterfaceOrientations~ipad") as? [String] ?? []
      return orientations == ["UIInterfaceOrientationPortrait"] ? .portrait : .all
    }
    return .allButUpsideDown
  }
}
