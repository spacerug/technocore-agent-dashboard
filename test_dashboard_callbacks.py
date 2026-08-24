from __future__ import annotations

import unittest
from unittest.mock import patch

from technocore_dashboard import DashboardApp


class ImmediateThread:
    """Run the worker now, but leave Tkinter's callback queued for later."""

    def __init__(self, *, target, daemon):
        self.target = target
        self.daemon = daemon

    def start(self) -> None:
        self.target()


class FakeDashboard:
    def __init__(self) -> None:
        self.busy_count = 0
        self.callbacks = []
        self.error = None

    def _set_activity(self, _text: str) -> None:
        pass

    def after(self, _delay: int, callback) -> None:
        self.callbacks.append(callback)

    def _background_failed(self, error: Exception) -> None:
        self.error = error

    def _background_succeeded(self, _result, _callback) -> None:
        raise AssertionError("The failing worker must not use the success callback.")


class DashboardCallbackTests(unittest.TestCase):
    def test_background_exception_survives_until_tkinter_callback(self) -> None:
        dashboard = FakeDashboard()

        def fail() -> None:
            raise RuntimeError("real background failure")

        with patch("technocore_dashboard.threading.Thread", ImmediateThread):
            DashboardApp._run_background(dashboard, "Checking...", fail, lambda _value: None)

        self.assertEqual(len(dashboard.callbacks), 1)
        # This executes after the worker's exception block has ended. Version
        # 1.1.0 raised NameError here because it captured the cleared `exc` name.
        dashboard.callbacks[0]()
        self.assertIsInstance(dashboard.error, RuntimeError)
        self.assertEqual(str(dashboard.error), "real background failure")


if __name__ == "__main__":
    unittest.main()
